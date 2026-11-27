import {
  toYymmdd,
  type XtxLeafValues,
  type XtxRawValues,
  type XtxRepeatedRawValues,
  type XtxRepeatedValues,
} from './xtx-document';
import { maxOccursOf, type XtxDetailOverflowRow } from './xtx-mapping-shared';
import type { XtxSchema } from './xtx-schema';
import { m } from '../../paraglide/messages';

export type XtxMethodApplicationKind = 'notice' | 'change';
export type XtxMethodApplicationAssetType = 'inventory' | 'securities' | 'crypto' | 'depreciable';

export interface XtxMethodApplication {
  kind: XtxMethodApplicationKind;
  assetType: XtxMethodApplicationAssetType;
  businessOrAssetType: string;
  assetClass: string;
  newMethod: string;
  currentMethod?: string;
  currentAdoptedYear?: number;
  memo?: string;
}

export interface XtxFilingNotices {
  closureDate?: string;
  blueReturnWithdrawalYear?: number;
  methodApplications: XtxMethodApplication[];
}

export interface XtxFilingNoticeTags {
  closure: string;
  closureDate: string;
  withdrawal: string;
  withdrawalYear: string;
  numberBlock: string;
  numberKubun: string;
  detailBlock: string;
  detailKind: string;
  detailAssetType: string;
  detailBusinessOrAssetType: string;
  detailAssetClass: string;
  detailNewMethod: string;
  detailCurrentGroup: string;
  detailCurrentMethod: string;
  detailCurrentYear: string;
  detailMemo: string;
}

function filingNoticeTags(
  page1: string,
  detailBlock: string,
  detailPrefix: string,
): XtxFilingNoticeTags {
  return {
    closure: `${page1}10`,
    closureDate: `${page1}20`,
    withdrawal: `${page1}30`,
    withdrawalYear: `${page1}40`,
    numberBlock: `${page1}50`,
    numberKubun: `${page1}60`,
    detailBlock,
    detailKind: `${detailPrefix}10`,
    detailAssetType: `${detailPrefix}20`,
    detailBusinessOrAssetType: `${detailPrefix}30`,
    detailAssetClass: `${detailPrefix}40`,
    detailNewMethod: `${detailPrefix}50`,
    detailCurrentGroup: `${detailPrefix}60`,
    detailCurrentMethod: `${detailPrefix}70`,
    detailCurrentYear: `${detailPrefix}80`,
    detailMemo: `${detailPrefix}90`,
  };
}

export const KOA110_FILING_NOTICE_TAGS = filingNoticeTags('AIS000', 'AIT00000', 'AIT000');
export const KOA130_FILING_NOTICE_TAGS = filingNoticeTags('AKS000', 'AKT00000', 'AKT000');
export const KOA210_FILING_NOTICE_TAGS = filingNoticeTags('AMJ000', 'AMM00000', 'AMM000');
export const KOA220_FILING_NOTICE_TAGS = filingNoticeTags('ANI000', 'ANG00700', 'ANG007');

export interface XtxFilingNoticeOutput {
  leafValues: XtxLeafValues;
  raw: XtxRawValues;
  repeats: XtxRepeatedValues;
  repeatsRaw: XtxRepeatedRawValues;
  overflow: XtxDetailOverflowRow[];
}

const BUSINESS_OR_ASSET_TYPE_MAX = 20;
const ASSET_CLASS_MAX = 40;
const NEW_METHOD_MAX = 20;
const CURRENT_METHOD_MAX = 20;
const MEMO_MAX = 40;

export class XtxFilingNoticeTextTooLongError extends Error {
  readonly tag: string;
  readonly max: number;
  constructor(tag: string, max: number) {
    super(`filing notice text too long: ${tag} (max ${max})`);
    this.name = 'XtxFilingNoticeTextTooLongError';
    this.tag = tag;
    this.max = max;
  }
}

const NUMBER_LABELS: (() => string)[] = [
  () => m.xtx_filing_notice_number_1(),
  () => m.xtx_filing_notice_number_2(),
  () => m.xtx_filing_notice_number_3(),
  () => m.xtx_filing_notice_number_4(),
  () => m.xtx_filing_notice_number_5(),
  () => m.xtx_filing_notice_number_6(),
  () => m.xtx_filing_notice_number_7(),
  () => m.xtx_filing_notice_number_8(),
];

const ASSET_TYPE_CODE: Record<XtxMethodApplicationAssetType, number> = {
  inventory: 1,
  securities: 2,
  crypto: 3,
  depreciable: 4,
};

const kubunXml = (code: number | string): string => `<kubun_CD>${code}</kubun_CD>`;
// 番号は 1〜4 が届出、5〜8 が同じ並びの変更承認申請
function numberOf(app: XtxMethodApplication): number {
  return ASSET_TYPE_CODE[app.assetType] + (app.kind === 'change' ? 4 : 0);
}

function numberLabel(n: number): string {
  return NUMBER_LABELS[n - 1]!();
}

function sortedUniqueNumbers(apps: readonly XtxMethodApplication[]): number[] {
  return [...new Set(apps.map(numberOf))].sort((a, b) => a - b);
}

function detailLabel(app: XtxMethodApplication): string {
  return app.assetClass === '' ? numberLabel(numberOf(app)) : app.assetClass;
}
// 採用した年は年分しか持たないため、元号の境目の 1989 年は一律で平成として扱う
function toGengoYear(year: number): string {
  if (year >= 2019) {
    return `<gen:era>5</gen:era><gen:yy>${year - 2018}</gen:yy>`;
  }
  if (year >= 1989) {
    return `<gen:era>4</gen:era><gen:yy>${year - 1988}</gen:yy>`;
  }
  return `<gen:era>3</gen:era><gen:yy>${year - 1925}</gen:yy>`;
}

function assertLength(value: string, tag: string, max: number): void {
  if ([...value].length > max) {
    throw new XtxFilingNoticeTextTooLongError(tag, max);
  }
}

export function buildFilingNoticeValues(
  notices: XtxFilingNotices | undefined,
  schema: XtxSchema,
  tags: XtxFilingNoticeTags,
): XtxFilingNoticeOutput {
  const out: XtxFilingNoticeOutput = {
    leafValues: {},
    raw: {},
    repeats: {},
    repeatsRaw: {},
    overflow: [],
  };
  if (!notices) {
    return out;
  }
  if (notices.closureDate !== undefined) {
    out.raw[tags.closure] = kubunXml(1);
    out.raw[tags.closureDate] = toYymmdd(notices.closureDate);
  }
  if (notices.blueReturnWithdrawalYear !== undefined) {
    out.raw[tags.withdrawal] = kubunXml(1);
    out.raw[tags.withdrawalYear] =
      `<gen:era>5</gen:era><gen:yy>${notices.blueReturnWithdrawalYear - 2018}</gen:yy>`;
  }
  const numbers = sortedUniqueNumbers(notices.methodApplications);
  const numberMax = maxOccursOf(schema, tags.numberBlock);
  const writtenNumbers = numbers.slice(0, numberMax);
  if (writtenNumbers.length > 0) {
    out.repeats[tags.numberBlock] = writtenNumbers.map(() => ({}));
    out.repeatsRaw[tags.numberBlock] = writtenNumbers.map((n) => ({
      [tags.numberKubun]: kubunXml(n),
    }));
  }
  for (const n of numbers.slice(numberMax)) {
    out.overflow.push({ section: 'filingNotice', label: numberLabel(n) });
  }
  const detailMax = maxOccursOf(schema, tags.detailBlock);
  const writtenApps = notices.methodApplications.slice(0, detailMax);
  if (writtenApps.length > 0) {
    out.repeats[tags.detailBlock] = writtenApps.map((app) => {
      assertLength(
        app.businessOrAssetType,
        tags.detailBusinessOrAssetType,
        BUSINESS_OR_ASSET_TYPE_MAX,
      );
      assertLength(app.assetClass, tags.detailAssetClass, ASSET_CLASS_MAX);
      assertLength(app.newMethod, tags.detailNewMethod, NEW_METHOD_MAX);
      const entry: XtxLeafValues = {
        [tags.detailBusinessOrAssetType]: app.businessOrAssetType,
        [tags.detailAssetClass]: app.assetClass,
        [tags.detailNewMethod]: app.newMethod,
      };
      if (app.currentMethod !== undefined) {
        assertLength(app.currentMethod, tags.detailCurrentMethod, CURRENT_METHOD_MAX);
        entry[tags.detailCurrentMethod] = app.currentMethod;
      }
      if (app.memo !== undefined) {
        assertLength(app.memo, tags.detailMemo, MEMO_MAX);
        entry[tags.detailMemo] = app.memo;
      }
      return entry;
    });
    out.repeatsRaw[tags.detailBlock] = writtenApps.map((app) => {
      const entry: XtxRawValues = {
        [tags.detailKind]: kubunXml(app.kind === 'notice' ? 1 : 2),
        [tags.detailAssetType]: kubunXml(ASSET_TYPE_CODE[app.assetType]),
      };
      if (app.currentAdoptedYear !== undefined) {
        entry[tags.detailCurrentYear] = toGengoYear(app.currentAdoptedYear);
      }
      return entry;
    });
  }
  for (const app of notices.methodApplications.slice(detailMax)) {
    out.overflow.push({ section: 'filingNotice', label: detailLabel(app) });
  }
  return out;
}
// .xtx へ書けない届出事項の内容を、画面へ出す提示行にする
export function filingNoticeRows(notices: XtxFilingNotices): XtxDetailOverflowRow[] {
  const rows: XtxDetailOverflowRow[] = [];
  if (notices.closureDate !== undefined) {
    rows.push({
      section: 'filingNotice',
      label: m.xtx_filing_notice_closure({ date: notices.closureDate.replaceAll('-', '.') }),
    });
  }
  if (notices.blueReturnWithdrawalYear !== undefined) {
    rows.push({
      section: 'filingNotice',
      label: m.xtx_filing_notice_blue_withdrawal({ year: notices.blueReturnWithdrawalYear }),
    });
  }
  for (const n of sortedUniqueNumbers(notices.methodApplications)) {
    rows.push({ section: 'filingNotice', label: numberLabel(n) });
  }
  for (const app of notices.methodApplications) {
    rows.push({ section: 'filingNotice', label: detailLabel(app) });
  }
  return rows;
}
