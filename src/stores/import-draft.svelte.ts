import { db } from '../db';
import { computeFileHash, findOverlappingRows } from '../domain/import';
import { findMatchingRule, findVendorByDefaultAccount, loadRules } from '../domain/rules';
import { describeLlmError, isAbortError, type LlmAdapter } from '../domain/llm';
import {
  classifyWithLlm,
  counterpartCandidates,
  shouldFillSuggestion,
  type ClassifyInput,
} from '../domain/llm-classify';
import { createLlmAdapter } from '../lib/llm-adapter';
import { formatBytes, MAX_CSV_BYTES } from '../lib/file-limit';
import { CsvEncodingError, decodeCsv } from '../lib/encoding';
import { taxRateForCategory } from '../lib/tax-category';
import { PARSERS, findParser } from '../parsers';
import type { ParsedTransaction } from '../parsers/types';
import { registerUnloadCheck } from '../router.svelte';
import { m } from '../paraglide/messages';
import { analysis } from './analysis.svelte';
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
  targets: ClassifyTarget[];
  host: string;
  fileHash: string;
  knownAccountCode: string;
}
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
      const adapter = await createLlmAdapter('classify');
      return {
        adapter,
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
      const bySide = new Map<'debit' | 'credit', ClassifyTarget[]>();
      for (const t of prepared.targets) {
        const s = t.row.transaction.side;
        const arr = bySide.get(s) ?? [];
        arr.push(t);
        bySide.set(s, arr);
      }

      let highCount = 0;
      let lowCount = 0;
      let noneCount = 0;
      let failedCount = 0;
      const inventoryLive = await computeInventoryLive();
      let aborted = false;

      for (const [knownSide, group] of bySide) {
        if (stale()) {
          aborted = true;
          break;
        }
        const inputs: ClassifyInput[] = group.map((g) => ({
          ref: String(g.index),
          description: g.row.description,
          amount: g.row.transaction.amount,
        }));
        const suggestions = await classifyWithLlm(
          prepared.adapter,
          inputs,
          {
            knownAccountCode: prepared.knownAccountCode,
            knownSide,
            candidateAccounts: counterpartCandidates(
              ledger.accounts,
              prepared.knownAccountCode,
              knownSide,
              inventoryLive,
            ),
          },
          { signal: job.controller.signal },
        );
        if (stale()) {
          aborted = true;
          break;
        }
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
              highCount++;
            } else {
              lowCount++;
            }
          } else if (s.failed) {
            failedCount++;
          } else {
            noneCount++;
          }
        }
      }
      if (aborted) {
        return;
      }
      const baseStatus =
        noneCount > 0
          ? m.import_llm_status_with_none({
              count: highCount + lowCount,
              high: highCount,
              low: lowCount,
              none: noneCount,
            })
          : m.import_llm_status({ count: highCount + lowCount, high: highCount, low: lowCount });
      this.llmStatus =
        failedCount > 0
          ? `${baseStatus} ${m.import_llm_status_failed({ failed: failedCount })}`
          : baseStatus;
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
