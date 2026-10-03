// android 環境専用の *_android キーが三語すべてに存在し、文字認識の利用状況開示を含むこと、
// エンジン名が新名称（端末内の文字認識／on-device text recognition／裝置內的文字辨識）を
// 使い旧名称（OS 内蔵の文字認識等）の表記を含まないこと、共用キー（*_native・_html 無印）の
// 文字列は変えていないことを確認する。
import { describe, expect, test } from 'vitest';
import ja from '../../messages/ja.json';
import en from '../../messages/en.json';
import zhTW from '../../messages/zh-TW.json';

const ANDROID_KEYS = [
  'disclaimer_bullet_llm_html_android',
  'backup_panel_intro_folder_android',
  'receipt_rule_engine_android',
  'receipt_rule_engine_name_android',
  'receipt_native_engine_notice_android',
  'ocr_native_unavailable_android',
] as const;

const NEW_ENGINE_NAME = {
  ja: '端末内の文字認識',
  en: 'on-device text recognition',
  zhTW: '裝置內的文字辨識',
};

const OLD_ENGINE_NAME_PATTERNS = [
  /OS 内蔵の文字認識/,
  /OS's built-in text recognition/,
  /OS built-in text recognition/,
  /OS's built-in recognition/,
  /作業系統內建的文字辨識/,
  /作業系統內建文字辨識/,
];
// 新エンジン名を含むべきキー。receipt 系の 4 キーは新名称をラベル・エラー・通知として使う。
// disclaimer_bullet_llm_html_android は本文中で言及するが専用テストで検証するため対象外、
// backup_panel_intro_folder_android はエンジン名に言及しない話題なので対象外。
const KEYS_WITH_NEW_ENGINE_NAME = [
  'receipt_rule_engine_android',
  'receipt_rule_engine_name_android',
  'receipt_native_engine_notice_android',
  'ocr_native_unavailable_android',
] as const;

describe('messages/*.json の *_android キー', () => {
  for (const key of ANDROID_KEYS) {
    test(`${key} が三語すべてに存在する`, () => {
      expect(typeof ja[key as keyof typeof ja]).toBe('string');
      expect(typeof en[key as keyof typeof en]).toBe('string');
      expect(typeof zhTW[key as keyof typeof zhTW]).toBe('string');
    });
  }

  for (const key of KEYS_WITH_NEW_ENGINE_NAME) {
    test(`${key} は新エンジン名を使い、旧名称の表記を含まない`, () => {
      expect(ja[key as keyof typeof ja]).toContain(NEW_ENGINE_NAME.ja);
      expect((en[key as keyof typeof en] as string).toLowerCase()).toContain(NEW_ENGINE_NAME.en);
      expect(zhTW[key as keyof typeof zhTW]).toContain(NEW_ENGINE_NAME.zhTW);
      for (const pattern of OLD_ENGINE_NAME_PATTERNS) {
        expect(ja[key as keyof typeof ja]).not.toMatch(pattern);
        expect(en[key as keyof typeof en]).not.toMatch(pattern);
        expect(zhTW[key as keyof typeof zhTW]).not.toMatch(pattern);
      }
    });
  }

  test('disclaimer_bullet_llm_html_android は ML Kit の利用状況開示を含み、新旧いずれのエンジン名でも送信なしと書かない', () => {
    expect(ja.disclaimer_bullet_llm_html_android).toContain('ML Kit');
    for (const pattern of OLD_ENGINE_NAME_PATTERNS) {
      expect(ja.disclaimer_bullet_llm_html_android).not.toMatch(pattern);
      expect(en.disclaimer_bullet_llm_html_android).not.toMatch(pattern);
      expect(zhTW.disclaimer_bullet_llm_html_android).not.toMatch(pattern);
    }
    expect(ja.disclaimer_bullet_llm_html_android).toContain(NEW_ENGINE_NAME.ja);
    expect(en.disclaimer_bullet_llm_html_android.toLowerCase()).toContain(NEW_ENGINE_NAME.en);
    expect(zhTW.disclaimer_bullet_llm_html_android).toContain(NEW_ENGINE_NAME.zhTW);
    expect(en.disclaimer_bullet_llm_html_android).toContain('ML Kit');
    expect(zhTW.disclaimer_bullet_llm_html_android).toContain('ML Kit');
  });
  // 新名称を含む文を句単位で切り出し、その文だけを検査する。キー全体だと Google Gemini の記述に
  // 引っかかって開示チェックが常に通ってしまうため。
  const NEW_NAME_SENTENCE_CASES = [
    {
      label: 'ja' as const,
      text: ja.disclaimer_bullet_llm_html_android,
      sep: '。',
      name: NEW_ENGINE_NAME.ja,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('利用状況'),
      noTransmissionPattern: /送信(そのもの)?が発生しません/,
    },
    {
      label: 'en' as const,
      text: en.disclaimer_bullet_llm_html_android,
      sep: '. ',
      name: NEW_ENGINE_NAME.en,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('usage information'),
      noTransmissionPattern: /sends nothing|no transmission/,
    },
    {
      label: 'zh' as const,
      text: zhTW.disclaimer_bullet_llm_html_android,
      sep: '。',
      name: NEW_ENGINE_NAME.zhTW,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('使用狀況'),
      noTransmissionPattern: /不會產生(任何)?(傳送|送出)|不會送出任何(東西|資料)/,
    },
  ];

  for (const {
    label,
    text,
    sep,
    name,
    hasUsageDisclosure,
    noTransmissionPattern,
  } of NEW_NAME_SENTENCE_CASES) {
    test(`disclaimer_bullet_llm_html_android(${label}): 新名称を含む文は 1 つだけで、利用状況開示があり、不送信とは書かない`, () => {
      const lowerName = name.toLowerCase();
      const sentences = text
        .split(sep)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase().includes(lowerName));
      expect(sentences).toHaveLength(1);
      const sentence = sentences[0]!;
      expect(hasUsageDisclosure(sentence)).toBe(true);
      expect(sentence).not.toMatch(noTransmissionPattern);
    });
  }
  // Nano の一句も「完全に送信されない」と読めてはいけないので、既存と同じく句単位で開示を確かめる。
  const NANO_NAME = {
    ja: '端末内 Gemini Nano',
    en: 'on-device gemini nano',
    zhTW: '裝置內 Gemini Nano',
  };
  const NANO_SENTENCE_CASES = [
    {
      label: 'ja' as const,
      text: ja.disclaimer_bullet_llm_html_android,
      sep: '。',
      name: NANO_NAME.ja,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('利用状況'),
      noTransmissionPattern: /送信(そのもの)?が発生しません|一切送信されません/,
    },
    {
      label: 'en' as const,
      text: en.disclaimer_bullet_llm_html_android,
      sep: '. ',
      name: NANO_NAME.en,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('usage information'),
      noTransmissionPattern: /sends nothing|no transmission/,
    },
    {
      label: 'zh' as const,
      text: zhTW.disclaimer_bullet_llm_html_android,
      sep: '。',
      name: NANO_NAME.zhTW,
      hasUsageDisclosure: (s: string) => s.includes('Google') && s.includes('使用狀況'),
      noTransmissionPattern: /不會產生(任何)?(傳送|送出)|不會送出任何(東西|資料)/,
    },
  ];

  for (const {
    label,
    text,
    sep,
    name,
    hasUsageDisclosure,
    noTransmissionPattern,
  } of NANO_SENTENCE_CASES) {
    test(`disclaimer_bullet_llm_html_android(${label}): Gemini Nano に触れる文は利用状況開示があり、不送信とは書かない`, () => {
      const lowerName = name.toLowerCase();
      const sentences = text
        .split(sep)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase().includes(lowerName));
      expect(sentences).toHaveLength(1);
      const sentence = sentences[0]!;
      expect(hasUsageDisclosure(sentence)).toBe(true);
      expect(sentence).not.toMatch(noTransmissionPattern);
    });
  }

  test('backup_panel_intro_folder_android は iCloud に言及しない', () => {
    expect(ja.backup_panel_intro_folder_android).not.toContain('iCloud');
    expect(en.backup_panel_intro_folder_android).not.toContain('iCloud');
    expect(zhTW.backup_panel_intro_folder_android).not.toContain('iCloud');
  });

  test('既存の *_native / 無印キーの文字列は変えていない', () => {
    expect(ja.disclaimer_bullet_llm_html_native).toContain(
      'Tesseract や OS 内蔵の文字認識など、端末内で完結するエンジンでは送信そのものが発生しません',
    );
    expect(ja.backup_panel_intro_folder_html).toContain(
      'iCloud Drive・パソコン版 Google ドライブ・Dropbox',
    );
  });
});
