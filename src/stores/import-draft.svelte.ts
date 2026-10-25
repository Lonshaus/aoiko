import { db } from '../db';
import type { Account } from '../db/types';
import { computeFileHash, findOverlappingRows } from '../domain/import';
import { findMatchingRule, findVendorByDefaultAccount, loadRules } from '../domain/rules';
import { describeLlmError, isAbortError, type LlmAdapter } from '../domain/llm';
import {
  classifyWithLlm,
  counterpartCandidates,
  shouldFillSuggestion,
  type ClassifyInput,
} from '../domain/llm-classify';
import { createLlmAdapterWithConfig } from '../lib/llm-adapter';
import {
  runClassifyInRunner,
  runnerConfig,
  type RunnerConfig,
  type RunnerSuggestion,
} from '../lib/native-runner-client';
import { formatBytes, MAX_CSV_BYTES } from '../lib/file-limit';
import { CsvEncodingError, decodeCsv } from '../lib/encoding';
import { taxRateForCategory } from '../lib/tax-category';
import { PARSERS, findParser } from '../parsers';
import type { ParsedTransaction } from '../parsers/types';
import { registerUnloadCheck } from '../router.svelte';
import { m } from '../paraglide/messages';
import { analysis, type AnalysisJob } from './analysis.svelte';
import { ledger } from './ledger.svelte';

export type RowState = {
  transaction: ParsedTransaction;
  counterpartAccountCode: string;
  counterpartSubAccountId: string;
  description: string;
  skip: boolean;
  matchedRuleId: string; // ルール一致時の ID、'' = 非適用
  vendorMatched: boolean; // 取引先の既定科目を適用した行（ルール不一致の場合のみ）
  llmConfidence: '' | 'high' | 'low'; // LLM 分類の信頼度、'' = LLM 未適用
  taxRate: number; // 相手科目の消費税率（科目の税区分から既定値を設定、上書き可）
  invoiceCompliant: boolean; // 適格請求書あり（仕入税額控除 100%）
};

export type ClassifyTarget = { row: RowState; index: number };

export interface PreparedClassify {
  adapter: LlmAdapter;
  // web view の外で走らせるときの設定。それ以外は null（従来の経路）。
  runner: RunnerConfig | null;
  targets: ClassifyTarget[];
  host: string;
  fileHash: string;
  knownAccountCode: string;
}

type ClassifyGroup = {
  knownSide: 'debit' | 'credit';
  inputs: ClassifyInput[];
  candidateAccounts: Account[];
};

type ClassifyCounts = { high: number; low: number; none: number; failed: number };

type Suggestion = RunnerSuggestion | Awaited<ReturnType<typeof classifyWithLlm>>[number];
// 確定仕訳は不可逆なので、分類器が書き得る科目コードを在庫運用の判定材料にしない
export async function computeInventoryLive(): Promise<boolean> {
  const itemCount = await db.inventoryItems.count();
  if (itemCount > 0) {
    return true;
  }
  const line = await db.journalLines.filter((l) => l.itemId !== undefined).first();
  return line !== undefined;
}
// 相手科目コードから税区分由来の既定税率を引く。
export function defaultTaxRateFor(accountCode: string): number {
  const acc = ledger.accounts.find((a) => a.code === accountCode);
  return taxRateForCategory(acc?.taxCategory);
}

export type LoadFileResult = 'rejected' | 'clear-input' | 'keep-input';
// 読み込んだ行は取込を押すまで DB に無い。画面を離れても失わないよう、コンポーネントではなくここに持つ。
class ImportDraft {
  selectedParserName = $state(PARSERS[0]?.name ?? '');
  fileName = $state('');
  fileHash = $state('');
  rows = $state<RowState[]>([]);
  page = $state(0);
  knownSubAccountId = $state('');
  duplicateNotice = $state('');
  parserChangedNotice = $state('');
  importing = $state(false);
  llmStatus = $state('');
  error = $state('');
  success = $state('');

  get dirty(): boolean {
    return this.rows.length > 0 && !this.importing;
  }
  // 分類中（取消し待ちを含む）は読み込み元を変えさせない。行の添字が別ファイルを指してしまう。
  get locked(): boolean {
    return analysis.isRunning('classify');
  }

  async loadFile(file: File): Promise<LoadFileResult> {
    if (this.locked) {
      return 'rejected';
    }
    this.error = '';
    this.success = '';
    this.parserChangedNotice = '';
    this.rows = [];
    this.page = 0;
    const parser = findParser(this.selectedParserName);
    if (!parser) {
      return 'keep-input';
    }
    if (file.size > MAX_CSV_BYTES) {
      this.error = m.common_file_too_large({
        size: formatBytes(file.size),
        limit: formatBytes(MAX_CSV_BYTES),
      });
      return 'clear-input';
    }
    this.fileName = file.name;
    try {
      const buffer = await file.arrayBuffer();
      const text = decodeCsv(buffer, parser.encoding);
      this.fileHash = await computeFileHash(text);

      const dup = await db.importBatches.where('fileHash').equals(this.fileHash).first();
      if (dup) {
        this.error = m.import_duplicate_error({
          date: new Date(dup.importedAt).toLocaleDateString('ja-JP'),
          name: dup.fileName,
        });
        return 'keep-input';
      }

      const txs = parser.parse(text);
      // 期間が重なる過去のインポートと重複する行を検出し、既定でスキップにする（誤検知に備え解除可能）。
      const overlapping = await findOverlappingRows(txs, parser.accountCode);
      const rules = await loadRules();
      const vendors = await db.vendors.toArray();
      this.rows = txs.map((t, i): RowState => {
        const rule = findMatchingRule(rules, t.description);
        const vendor = rule ? null : findVendorByDefaultAccount(vendors, t.description);
        const code = rule?.accountCode ?? vendor?.defaultAccountCode ?? '';
        return {
          transaction: t,
          counterpartAccountCode: code,
          counterpartSubAccountId: '',
          description: t.description,
          skip: overlapping.has(i),
          matchedRuleId: rule?.id ?? '',
          vendorMatched: vendor !== null,
          llmConfidence: '',
          taxRate: defaultTaxRateFor(code),
          invoiceCompliant: false,
        };
      });
      this.duplicateNotice =
        overlapping.size > 0 ? m.import_overlap_notice({ count: overlapping.size }) : '';
      // 同じファイルを選び直しても change が発火するように、成功時も input をクリアする
      return 'clear-input';
    } catch (e) {
      if (e instanceof CsvEncodingError) {
        this.error = m.import_encoding_error({ parser: parser.displayName });
        // 取込元を選び直して同じファイルを再選択できるようにする
        return 'clear-input';
      }
      this.error = e instanceof Error ? e.message : String(e);
      return 'keep-input';
    }
  }

  async prepareClassify(): Promise<PreparedClassify | null> {
    const parser = findParser(this.selectedParserName);
    if (!parser || analysis.busy) {
      return null;
    }
    this.llmStatus = '';
    this.error = '';

    const targets = this.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !row.skip && !row.counterpartAccountCode);
    if (targets.length === 0) {
      this.llmStatus = m.import_llm_no_target();
      return null;
    }
    const fileHash = this.fileHash;
    try {
      const { adapter, config } = await createLlmAdapterWithConfig('classify');
      return {
        adapter,
        runner: runnerConfig(config),
        targets,
        host: adapter.destinationHost,
        fileHash,
        knownAccountCode: parser.accountCode,
      };
    } catch (e) {
      this.error = describeLlmError(e);
      return null;
    }
  }
  // 側（借方・貸方）ごとに 1 グループ。どちらの経路も同じグループを作る。
  private async buildGroups(prepared: PreparedClassify): Promise<ClassifyGroup[]> {
    const bySide = new Map<'debit' | 'credit', ClassifyTarget[]>();
    for (const t of prepared.targets) {
      const s = t.row.transaction.side;
      const arr = bySide.get(s) ?? [];
      arr.push(t);
      bySide.set(s, arr);
    }
    const inventoryLive = await computeInventoryLive();
    return [...bySide].map(([knownSide, group]) => ({
      knownSide,
      inputs: group.map((g) => ({
        ref: String(g.index),
        description: g.row.description,
        amount: g.row.transaction.amount,
      })),
      candidateAccounts: counterpartCandidates(
        ledger.accounts,
        prepared.knownAccountCode,
        knownSide,
        inventoryLive,
      ),
    }));
  }

  private applySuggestions(suggestions: Suggestion[], counts: ClassifyCounts): void {
    for (const s of suggestions) {
      const idx = Number(s.ref);
      const row = this.rows[idx];
      if (!row) {
        continue;
      }
      if (shouldFillSuggestion(s)) {
        row.counterpartAccountCode = s.accountCode;
        row.taxRate = defaultTaxRateFor(s.accountCode);
        row.llmConfidence = s.confidence;
        if (s.confidence === 'high') {
          counts.high++;
        } else {
          counts.low++;
        }
      } else if (s.failed) {
        counts.failed++;
      } else {
        counts.none++;
      }
    }
  }

  private setStatus(counts: ClassifyCounts): void {
    const baseStatus =
      counts.none > 0
        ? m.import_llm_status_with_none({
            count: counts.high + counts.low,
            high: counts.high,
            low: counts.low,
            none: counts.none,
          })
        : m.import_llm_status({
            count: counts.high + counts.low,
            high: counts.high,
            low: counts.low,
          });
    this.llmStatus =
      counts.failed > 0
        ? `${baseStatus} ${m.import_llm_status_failed({ failed: counts.failed })}`
        : baseStatus;
  }

  async runClassify(prepared: PreparedClassify): Promise<void> {
    if (prepared.fileHash !== this.fileHash) {
      return;
    }
    const job = analysis.begin('classify');
    if (job === null) {
      this.error = m.analysis_busy_other();
      return;
    }
    // 取消し後や別ファイルへの差し替え後は、戻ってきた提案を行へ書かない。
    const stale = () => analysis.isCancelled(job) || prepared.fileHash !== this.fileHash;
    let outcome: 'done' | 'failed' | 'cancelled' = 'cancelled';
    try {
      const groups = await this.buildGroups(prepared);
      const counts: ClassifyCounts = { high: 0, low: 0, none: 0, failed: 0 };
      if (prepared.runner !== null) {
        outcome = await this.runInRunner(prepared, prepared.runner, groups, job, stale, counts);
        return;
      }
      for (const group of groups) {
        if (stale()) {
          return;
        }
        const suggestions = await classifyWithLlm(
          prepared.adapter,
          group.inputs,
          {
            knownAccountCode: prepared.knownAccountCode,
            knownSide: group.knownSide,
            candidateAccounts: group.candidateAccounts,
          },
          { signal: job.controller.signal },
        );
        if (stale()) {
          return;
        }
        this.applySuggestions(suggestions, counts);
      }
      this.setStatus(counts);
      outcome = 'done';
    } catch (e) {
      if (!stale() && !isAbortError(e)) {
        outcome = 'failed';
        this.error = describeLlmError(e);
      }
    } finally {
      analysis.finish(job, outcome);
    }
  }
  // すべてのグループを 1 つのジョブで送り、戻った提案をグループの順に従来と同じ判定で書く。取消しの後に届いた
  // グループは、取消しの前に終わっていたグループなので、ファイルが同じなら書く（従来の経路で取消し前に書かれる行と同じ）。
  private async runInRunner(
    prepared: PreparedClassify,
    runner: RunnerConfig,
    groups: ClassifyGroup[],
    job: AnalysisJob,
    stale: () => boolean,
    counts: ClassifyCounts,
  ): Promise<'done' | 'failed' | 'cancelled'> {
    if (stale()) {
      return 'cancelled';
    }
    const result = await runClassifyInRunner(
      runner,
      prepared.host,
      groups.map((group) => ({
        knownSide: group.knownSide,
        inputs: group.inputs,
        knownAccountCode: prepared.knownAccountCode,
        candidateAccounts: group.candidateAccounts,
      })),
      job.controller.signal,
    );
    if (result.kind === 'cancelled') {
      if (prepared.fileHash === this.fileHash) {
        for (const partial of result.partial) {
          this.applySuggestions(partial.suggestions, counts);
        }
      }
      return 'cancelled';
    }
    if (result.kind === 'failed') {
      for (const partial of result.partial) {
        if (stale()) {
          return 'cancelled';
        }
        this.applySuggestions(partial.suggestions, counts);
      }
      if (stale()) {
        return 'cancelled';
      }
      this.error = describeLlmError(result.error);
      return 'failed';
    }
    for (const suggestions of result.groups) {
      if (stale()) {
        return 'cancelled';
      }
      this.applySuggestions(suggestions, counts);
    }
    this.setStatus(counts);
    return 'done';
  }

  reset(): void {
    if (analysis.isRunning('classify')) {
      analysis.cancel();
    }
    this.rows = [];
    this.page = 0;
    this.fileName = '';
    this.fileHash = '';
    this.knownSubAccountId = '';
    this.duplicateNotice = '';
    this.parserChangedNotice = '';
    this.error = '';
  }
}

export const importDraft = new ImportDraft();
registerUnloadCheck(() => importDraft.dirty);
