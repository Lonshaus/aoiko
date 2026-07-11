// 消費税 .xtx（SHA020・SHB070）の実 W3C XSD validation テスト。
// xtx-validate.test.ts と同じ手法（非公式 include ラッパ経由の xmllint）を、
// docs/xtx-spec/shohi/ 配下の消費税様式に対して行う。
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildFormFragment, type XtxLeafValues, type XtxRawValues } from './xtx-document';
import { buildGeneralXtx, buildSimplifiedXtx, buildTwoWariXtx } from './xtx-consumption-tax';
import { mapSimplified, mapTwoWari } from './xtx-mapping-sha020';
import { mapGeneral } from './xtx-mapping-sha010';
import sha020 from './xtx-schema-sha020.generated.json';
import shb070 from './xtx-schema-shb070.generated.json';
import shb047 from './xtx-schema-shb047.generated.json';
import shb067 from './xtx-schema-shb067.generated.json';
import sha010 from './xtx-schema-sha010.generated.json';
import shb017 from './xtx-schema-shb017.generated.json';
import shb033 from './xtx-schema-shb033.generated.json';
import type { XtxSchema } from './xtx-schema';
import { D } from '../../lib/decimal';

// 課税売上割合100%（免税・非課税売上なし）を前提とするテスト用の既定値
function zeroExtras() {
  return {
    exportExemptSalesBase: D('0'),
    nonTaxableSalesBase: D('0'),
    inputCommon10: D('0'),
    inputCommon8: D('0'),
    inputNonTaxableOnly10: D('0'),
    inputNonTaxableOnly8: D('0'),
    importTax10: D('0'),
    importTax8: D('0'),
    reverseChargeBase: D('0'),
    reverseChargeTax: D('0'),
    attributionMethod: 'proportional' as const,
    ...badDebtZeroExtras(),
  };
}

// 貸倒れ・貸倒回収なしを前提とするテスト用の既定値（mapTwoWari/mapSimplified 共通）
function badDebtZeroExtras() {
  return {
    badDebtTax10: D('0'),
    badDebtTax8: D('0'),
    badDebtRecoveryTax10: D('0'),
    badDebtRecoveryTax8: D('0'),
  };
}

const NS = 'http://xml.e-tax.nta.go.jp/XSD/shohi';
const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(HERE, '../../../docs/xtx-spec/shohi');

function xmllintAvailable(): boolean {
  const r = spawnSync('xmllint', ['--version']);
  return r.error === undefined && r.status === 0;
}

function validate(
  wrapper: string,
  frag: string
): { ok: boolean; out: string } {
  const doc =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<ValidationRoot xmlns="${NS}" xmlns:gen="http://xml.e-tax.nta.go.jp/XSD/general">\n${frag}\n</ValidationRoot>\n`;
  const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-'));
  const xmlPath = join(dir, 'doc.xml');
  writeFileSync(xmlPath, doc, 'utf8');
  const r = spawnSync(
    'xmllint',
    ['--noout', '--schema', join(SPEC_DIR, wrapper), xmlPath],
    { encoding: 'utf8' }
  );
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const hasXmllint = xmllintAvailable();
const maybe = hasXmllint ? test : test.skip;

describe('消費税 .xtx 実 XSD validation（公式 xsd / xmllint）', () => {
  if (!hasXmllint) {
    test('xmllint 不在のため skip（CI は libxml2-utils 導入で強制）', () => {
      expect(hasXmllint).toBe(false);
    });
  }

  maybe('SHA020 参照側が公式 xsd に適合する', () => {
    // firstPageLeaf は SHA020 の先頭 leaf（ABH00170、複合型の年月日）を拾ってしまうため、
    // 単純な gen:kingaku leaf を明示指定する。
    const frag = buildFormFragment(
      sha020 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { ABI00010: '100' }
    );
    const { ok, out } = validate('_valwrap-SHA020.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('SHB070 参照側が公式 xsd に適合する', () => {
    // firstPageLeaf は「level===1 ごとに新ページ」とみなすため、単頁様式の SHB070
    // （AYA00000/AYB00000/…がいずれも level 1）では最初のセクション止まりで
    // 値が見つからない。明示的に既知の gen:kingaku leaf を指定する。
    const frag = buildFormFragment(
      shb070 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { AYB00020: '100' }
    );
    const { ok, out } = validate('_valwrap-SHB070.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('mapTwoWari の実 mapping 経路（SHA020）が公式 xsd に適合する', () => {
    const mapping = mapTwoWari({
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...badDebtZeroExtras(),
    });
    const frag = buildFormFragment(
      sha020 as XtxSchema,
      {},
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      mapping.sha020,
      {},
      mapping.sha020Raw
    );
    const { ok, out } = validate('_valwrap-SHA020.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('mapTwoWari の実 mapping 経路（SHB070）が公式 xsd に適合する', () => {
    const mapping = mapTwoWari({
      taxableBase10: D('1000000'),
      taxableBase8: D('500000'),
      ...badDebtZeroExtras(),
    });
    const frag = buildFormFragment(
      shb070 as XtxSchema,
      {},
      { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
      mapping.shb070
    );
    const { ok, out } = validate('_valwrap-SHB070.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('組立済バンドル（buildTwoWariXtx）が公式 xsd に適合する（SHA020・SHB070 両方）', () => {
    const xml = buildTwoWariXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...badDebtZeroExtras(),
    });
    // 手続 RSH0030（簡易課税・個人）。RSH0010（一般・個人）は CONTENTS が SHA010
    // 系統のみ許可し SHA020 系統を受け付けない（実機組み込みで発覚、2026-07-05）。
    expect(xml).toMatch(/<RSH0030 VR="23\.2\.0" id="RSH0030">/);
    const forms: Array<[string, string]> = [
      ['SHA020', '_valwrap-SHA020.xsd'],
      ['SHB070', '_valwrap-SHB070.xsd'],
    ];
    for (const [tag, wrapper] of forms) {
      const m = new RegExp(`<${tag} [\\s\\S]*?</${tag}>`).exec(xml);
      expect(m, `${tag} subtree not found`).not.toBeNull();
      const { ok, out } = validate(wrapper, m![0]);
      expect(out).not.toContain('Schemas parser error');
      expect(ok, `${tag}: ${out}`).toBe(true);
    }
  });

  maybe('簡易課税の中間申告（仮決算方式）が公式 xsd に適合する', () => {
    const xml = buildSimplifiedXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...badDebtZeroExtras(),
      interimPeriod: { start: '2026-07-01', end: '2026-09-30' },
      interimPaidNational: D('10000'),
    });
    expect(xml).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>2</kubun_CD></SHINKOKU_KBN>');
    const m = /<SHA020 [\s\S]*?<\/SHA020>/.exec(xml);
    expect(m, 'SHA020 subtree not found').not.toBeNull();
    const { ok, out } = validate('_valwrap-SHA020.xsd', m![0]);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('SHB047 参照側が公式 xsd に適合する', () => {
    const frag = buildFormFragment(
      shb047 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { DUB00010: '100' }
    );
    const { ok, out } = validate('_valwrap-SHB047.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('SHB067 参照側が公式 xsd に適合する', () => {
    const frag = buildFormFragment(
      shb067 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { DVB00020: '100' }
    );
    const { ok, out } = validate('_valwrap-SHB067.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('mapSimplified の実 mapping 経路（SHA020・SHB047・SHB067）が公式 xsd に適合する', () => {
    const mapping = mapSimplified({
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...badDebtZeroExtras(),
    });
    const cases: Array<[string, string, XtxSchema, XtxLeafValues, XtxRawValues?]> = [
      ['SHA020', '_valwrap-SHA020.xsd', sha020 as XtxSchema, mapping.sha020],
      ['SHB047', '_valwrap-SHB047.xsd', shb047 as XtxSchema, mapping.shb047],
      ['SHB067', '_valwrap-SHB067.xsd', shb067 as XtxSchema, mapping.shb067, mapping.shb067Raw],
    ];
    for (const [label, wrapper, schema, leafValues, raw] of cases) {
      const frag = buildFormFragment(
        schema,
        {},
        { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
        leafValues,
        {},
        raw ?? {}
      );
      const { ok, out } = validate(wrapper, frag);
      expect(out, label).not.toContain('Schemas parser error');
      expect(ok, `${label}: ${out}`).toBe(true);
    }
  });

  maybe(
    '組立済バンドル（buildSimplifiedXtx）が公式 xsd に適合する（SHA020・SHB047・SHB067）',
    () => {
      const xml = buildSimplifiedXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer: {
          riyoshaId: '1234567890123456',
          name: '青井 太郎',
          zip: '1800001',
          address: '東京都武蔵野市〇〇1-2-3',
          zeimushoCode: '01101',
          zeimushoName: '麹町',
        },
        taxableBase10: D('2000000'),
        taxableBase8: D('0'),
        category: 5,
        deemedInputRate: 0.5,
        ...badDebtZeroExtras(),
      });
      const forms: Array<[string, string]> = [
        ['SHA020', '_valwrap-SHA020.xsd'],
        ['SHB047', '_valwrap-SHB047.xsd'],
        ['SHB067', '_valwrap-SHB067.xsd'],
      ];
      for (const [tag, wrapper] of forms) {
        const m = new RegExp(`<${tag} [\\s\\S]*?</${tag}>`).exec(xml);
        expect(m, `${tag} subtree not found`).not.toBeNull();
        const { ok, out } = validate(wrapper, m![0]);
        expect(out).not.toContain('Schemas parser error');
        expect(ok, `${tag}: ${out}`).toBe(true);
      }
    }
  );

  maybe('SHA010 参照側が公式 xsd に適合する', () => {
    const frag = buildFormFragment(
      sha010 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { AAJ00010: '100' }
    );
    const { ok, out } = validate('_valwrap-SHA010.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('SHB017 参照側が公式 xsd に適合する', () => {
    const frag = buildFormFragment(
      shb017 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { DSB00010: '100' }
    );
    const { ok, out } = validate('_valwrap-SHB017.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('SHB033 参照側が公式 xsd に適合する', () => {
    const frag = buildFormFragment(
      shb033 as XtxSchema,
      {},
      { creatorName: '青井事務所', creationDate: '2026-05-13' },
      { DTB00020: '100' }
    );
    const { ok, out } = validate('_valwrap-SHB033.xsd', frag);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('mapGeneral の実 mapping 経路（SHA010・SHB017・SHB033）が公式 xsd に適合する', () => {
    const mapping = mapGeneral({
      taxableBase10: D('3000000'),
      taxableBase8: D('0'),
      input10: D('100000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    const cases: Array<[string, string, XtxSchema, XtxLeafValues]> = [
      ['SHA010', '_valwrap-SHA010.xsd', sha010 as XtxSchema, mapping.sha010],
      ['SHB017', '_valwrap-SHB017.xsd', shb017 as XtxSchema, mapping.shb017],
      ['SHB033', '_valwrap-SHB033.xsd', shb033 as XtxSchema, mapping.shb033],
    ];
    for (const [label, wrapper, schema, leafValues] of cases) {
      const frag = buildFormFragment(
        schema,
        {},
        { creatorName: 'aoikoウェブ事務所', creationDate: '2026-05-13' },
        leafValues
      );
      const { ok, out } = validate(wrapper, frag);
      expect(out, label).not.toContain('Schemas parser error');
      expect(ok, `${label}: ${out}`).toBe(true);
    }
  });

  maybe(
    '組立済バンドル（buildGeneralXtx）が公式 xsd に適合する（SHA010・SHB017・SHB033）',
    () => {
      const xml = buildGeneralXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer: {
          riyoshaId: '1234567890123456',
          name: '青井 太郎',
          zip: '1800001',
          address: '東京都武蔵野市〇〇1-2-3',
          zeimushoCode: '01101',
          zeimushoName: '麹町',
        },
        taxableBase10: D('3000000'),
        taxableBase8: D('0'),
        input10: D('100000'),
        input8: D('0'),
        ...zeroExtras(),
      });
      const forms: Array<[string, string]> = [
        ['SHA010', '_valwrap-SHA010.xsd'],
        ['SHB017', '_valwrap-SHB017.xsd'],
        ['SHB033', '_valwrap-SHB033.xsd'],
      ];
      for (const [tag, wrapper] of forms) {
        const m = new RegExp(`<${tag} [\\s\\S]*?</${tag}>`).exec(xml);
        expect(m, `${tag} subtree not found`).not.toBeNull();
        const { ok, out } = validate(wrapper, m![0]);
        expect(out).not.toContain('Schemas parser error');
        expect(ok, `${tag}: ${out}`).toBe(true);
      }
    }
  );

  maybe(
    '中間申告（仮決算方式・SHINKOKU_KBN=2＋対象期間＋中間納付税額）が公式 xsd に適合する',
    () => {
      const xml = buildGeneralXtx({
        year: 2026,
        businessName: 'aoikoウェブ事務所',
        filer: {
          riyoshaId: '1234567890123456',
          name: '青井 太郎',
          zip: '1800001',
          address: '東京都武蔵野市〇〇1-2-3',
          zeimushoCode: '01101',
          zeimushoName: '麹町',
        },
        taxableBase10: D('1000000'),
        taxableBase8: D('0'),
        input10: D('30000'),
        input8: D('0'),
        ...zeroExtras(),
        interimPeriod: { start: '2026-01-01', end: '2026-06-30' },
      });
      expect(xml).toContain('<SHINKOKU_KBN ID="SHINKOKU_KBN"><kubun_CD>2</kubun_CD></SHINKOKU_KBN>');
      expect(xml).toContain(
        '<AAI00160><AAI00170><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>1</gen:mm><gen:dd>1</gen:dd></AAI00170>' +
          '<AAI00180><gen:era>5</gen:era><gen:yy>8</gen:yy><gen:mm>6</gen:mm><gen:dd>30</gen:dd></AAI00180></AAI00160>'
      );
      const m = /<SHA010 [\s\S]*?<\/SHA010>/.exec(xml);
      expect(m, 'SHA010 subtree not found').not.toBeNull();
      const { ok, out } = validate('_valwrap-SHA010.xsd', m![0]);
      expect(out).not.toContain('Schemas parser error');
      expect(ok, out).toBe(true);
    }
  );

  maybe('確定申告への中間納付税額の充当（AAJ00110-130）が公式 xsd に適合する', () => {
    const xml = buildGeneralXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      taxableBase10: D('3000000'),
      taxableBase8: D('0'),
      input10: D('100000'),
      input8: D('0'),
      ...zeroExtras(),
      interimPaidNational: D('50000'),
      interimPaidLocal: D('10000'),
    });
    expect(xml).toContain('<AAJ00110>50000</AAJ00110>');
    expect(xml).toContain('<AAJ00120>84000</AAJ00120>');
    const m = /<SHA010 [\s\S]*?<\/SHA010>/.exec(xml);
    expect(m, 'SHA010 subtree not found').not.toBeNull();
    const { ok, out } = validate('_valwrap-SHA010.xsd', m![0]);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('本体還付（控除不足還付税額 AAJ00090）が公式 xsd に適合する', () => {
    const xml = buildGeneralXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer: {
        riyoshaId: '1234567890123456',
        name: '青井 太郎',
        zip: '1800001',
        address: '東京都武蔵野市〇〇1-2-3',
        zeimushoCode: '01101',
        zeimushoName: '麹町',
      },
      taxableBase10: D('1000000'),
      taxableBase8: D('0'),
      input10: D('200000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    // 差引税額（⑨）へ負値を書かず、控除不足還付税額（⑧）へ正値。合計は符号付き（負＝還付）
    expect(xml).toContain('<AAJ00090>122000</AAJ00090>');
    expect(xml).not.toContain('<AAJ00100>');
    expect(xml).toContain('<AAK00130>-156400</AAK00130>');
    const m = /<SHA010 [\s\S]*?<\/SHA010>/.exec(xml);
    expect(m, 'SHA010 subtree not found').not.toBeNull();
    const { ok, out } = validate('_valwrap-SHA010.xsd', m![0]);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });
});