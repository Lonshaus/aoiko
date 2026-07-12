// 消費税 .xtx の「封包全体」を実 W3C XSD で検証するテスト。
//
// xtx-validate-consumption-tax.test.ts は様式（SHA020/SHB070等）の参照側フラグメントを
// 個別に検証するのみで、手続（RSH0010/RSH0030）の CONTENTS がその様式を実際に
// 許可しているかは検証していなかった。2026-07-05、実機組み込みで
// 「不明な要素 'SHA020'」エラーが発生し発覚：RSH0010（一般・個人）の CONTENTS 型は
// SHA010 系統の xsd:group のみを許可し、SHA020 系統は許可しない
// （SHA020 系統は RSH0030＝簡易課税・個人が正しい）。
//
// 本テストは RSH0010-232.xsd／RSH0030-232.xsd が公開しているグローバル要素 <DATA> に
// 対して、buildTwoWariXtx 等が実際に組み立てた完全な .xtx 文字列をそのまま
// xmllint 検証する。ValidationRoot ラッパは不要（DATA 自体が public element のため）。
/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildGeneralXtx, buildSimplifiedXtx, buildTwoWariXtx } from './xtx-consumption-tax';
import { D } from '../../lib/decimal';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = resolve(HERE, '../../../docs/xtx-spec/shohi');

function xmllintAvailable(): boolean {
  const r = spawnSync('xmllint', ['--version']);
  return r.error === undefined && r.status === 0;
}

function validateAgainstSchema(schemaFile: string, xml: string): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aoiko-xtx-envelope-'));
  const xmlPath = join(dir, 'doc.xml');
  writeFileSync(xmlPath, xml, 'utf8');
  const r = spawnSync('xmllint', ['--noout', '--schema', join(SPEC_DIR, schemaFile), xmlPath], {
    encoding: 'utf8',
  });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const hasXmllint = xmllintAvailable();
const maybe = hasXmllint ? test : test.skip;

const filer = {
  riyoshaId: '1234567890123456',
  name: '青井 太郎',
  zip: '1800001',
  address: '東京都武蔵野市〇〇1-2-3',
  zeimushoCode: '01101',
  zeimushoName: '麹町',
};

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
    reverseChargeCommonTax: D('0'),
    reverseChargeNonTaxableOnlyTax: D('0'),
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

describe('消費税 .xtx 封包全体の実 XSD validation（手続レベル、xmllint）', () => {
  if (!hasXmllint) {
    test('xmllint 不在のため skip（CI は libxml2-utils 導入で強制）', () => {
      expect(hasXmllint).toBe(false);
    });
  }

  maybe('buildTwoWariXtx（手続 RSH0030）の封包全体が公式 xsd に適合する', () => {
    const xml = buildTwoWariXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer,
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...badDebtZeroExtras(),
    });
    const { ok, out } = validateAgainstSchema('RSH0030-232.xsd', xml);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('buildSimplifiedXtx（手続 RSH0030）の封包全体が公式 xsd に適合する', () => {
    const xml = buildSimplifiedXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer,
      taxableBase10: D('2000000'),
      taxableBase8: D('0'),
      category: 5,
      deemedInputRate: 0.5,
      ...badDebtZeroExtras(),
    });
    const { ok, out } = validateAgainstSchema('RSH0030-232.xsd', xml);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  maybe('buildGeneralXtx（手続 RSH0010）の封包全体が公式 xsd に適合する', () => {
    const xml = buildGeneralXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer,
      taxableBase10: D('3000000'),
      taxableBase8: D('0'),
      input10: D('100000'),
      input8: D('0'),
      ...zeroExtras(),
    });
    const { ok, out } = validateAgainstSchema('RSH0010-232.xsd', xml);
    expect(out).not.toContain('Schemas parser error');
    expect(ok, out).toBe(true);
  });

  // 逆検証：SHA020 系統を RSH0010（一般・個人）に流し込むと拒否されることを確認する。
  // 今回の実機不具合（procedure_CD の取り違え）を二度と作り込まないための回帰テスト。
  maybe('buildTwoWariXtx を誤って RSH0010 の xsd で検証すると失敗する（回帰確認）', () => {
    const xml = buildTwoWariXtx({
      year: 2026,
      businessName: 'aoikoウェブ事務所',
      filer,
      taxableBase10: D('6008481'),
      taxableBase8: D('0'),
      ...badDebtZeroExtras(),
    });
    const wrongXml = xml.replace(/RSH0030/g, 'RSH0010');
    const { ok } = validateAgainstSchema('RSH0010-232.xsd', wrongXml);
    expect(ok).toBe(false);
  });
});
