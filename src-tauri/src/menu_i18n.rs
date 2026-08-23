// ネイティブメニューの文言。web 側のメッセージカタログ（公開 repo の messages/*.json）は
// WebView の中でしか読めないため、メニューだけはこちら側に辞書を持つ。
//
// `tr` は Key と Locale の両方で網羅 match になっている。Key を足して訳を書き忘れると
// コンパイルが通らない。訳抜けのままメニューへ出る事故はこれで防ぐ。
//
// 繁體中文の文言は ある環境 自身が出しているものに合わせてある（Ventura 13.3 の あるブラウザ の
// メニューを読み出して確認）。省略記号は日本語と英語が … (U+2026)、繁體中文は ⋯ (U+22EF) で、
// システムの表記がそうなっている。

/// UI 言語。タグは公開 repo の paraglide の locales（`src/paraglide/runtime.js` の
/// `locales`）と同じ綴りにしてある。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Locale {
    Ja,
    ZhTw,
    En,
}

impl Locale {
    /// 未知のタグは None。web 側が locales を増やしたとき、呼び出し側はメニューを
    /// 作り直さず今の表示のままにする（知らない言語で作り直すより現状維持のほうが安全）。
    pub fn from_tag(tag: &str) -> Option<Self> {
        match tag {
            "ja" => Some(Self::Ja),
            "zh-TW" => Some(Self::ZhTw),
            "en" => Some(Self::En),
            _ => None,
        }
    }

    pub fn tag(self) -> &'static str {
        match self {
            Self::Ja => "ja",
            Self::ZhTw => "zh-TW",
            Self::En => "en",
        }
    }
}

/// メニューに出る文字列の種類。
// ある環境 と ある環境 でメニューの構成そのものが違うため、どちらの環境でも使われない
// 種類が必ず残る。cfg で切ると使わない側の訳がテストの網羅から漏れるので、
// 全部そろえたまま未使用の警告だけ黙らせる。
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    About,
    Services,
    Hide,
    HideOthers,
    ShowAll,
    Quit,
    FileMenu,
    Print,
    CloseWindow,
    EditMenu,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    ViewMenu,
    Reload,
    FullScreen,
    WindowMenu,
    Minimize,
    Zoom,
    // ここから ある環境 用。同じ操作でも既定の綴りが ある環境 と違い（元に戻す／取り消す、
    // 檢視／顯示方式）、`&` の後ろ 1 文字がニーモニックとして下線付きで出る。
    // ある環境 側の文言に `&` を混ぜられないので、種類ごと分ける。
    WinFileMenu,
    WinEditMenu,
    WinViewMenu,
    WinHelpMenu,
    WinPrint,
    WinExit,
    WinReload,
    WinFullScreen,
    WinAbout,
    WinUndo,
    WinRedo,
    WinCut,
    WinCopy,
    WinPaste,
    WinSelectAll,
}

pub fn tr(locale: Locale, key: Key) -> &'static str {
    match key {
        Key::About => match locale {
            Locale::Ja => "aoiko について",
            Locale::ZhTw => "關於 aoiko",
            Locale::En => "About aoiko",
        },
        Key::Services => match locale {
            Locale::Ja => "サービス",
            Locale::ZhTw => "服務",
            Locale::En => "Services",
        },
        Key::Hide => match locale {
            Locale::Ja => "aoiko を隠す",
            Locale::ZhTw => "隱藏 aoiko",
            Locale::En => "Hide aoiko",
        },
        Key::HideOthers => match locale {
            Locale::Ja => "ほかを隠す",
            Locale::ZhTw => "隱藏其他",
            Locale::En => "Hide Others",
        },
        Key::ShowAll => match locale {
            Locale::Ja => "すべてを表示",
            Locale::ZhTw => "顯示全部",
            Locale::En => "Show All",
        },
        Key::Quit => match locale {
            Locale::Ja => "aoiko を終了",
            Locale::ZhTw => "結束 aoiko",
            Locale::En => "Quit aoiko",
        },
        Key::FileMenu => match locale {
            Locale::Ja => "ファイル",
            Locale::ZhTw => "檔案",
            Locale::En => "File",
        },
        Key::Print => match locale {
            Locale::Ja => "印刷…",
            Locale::ZhTw => "列印⋯",
            Locale::En => "Print…",
        },
        Key::CloseWindow => match locale {
            Locale::Ja => "ウィンドウを閉じる",
            Locale::ZhTw => "關閉視窗",
            Locale::En => "Close Window",
        },
        Key::EditMenu => match locale {
            Locale::Ja => "編集",
            Locale::ZhTw => "編輯",
            Locale::En => "Edit",
        },
        Key::Undo => match locale {
            Locale::Ja => "取り消す",
            Locale::ZhTw => "還原",
            Locale::En => "Undo",
        },
        Key::Redo => match locale {
            Locale::Ja => "やり直す",
            Locale::ZhTw => "重做",
            Locale::En => "Redo",
        },
        Key::Cut => match locale {
            Locale::Ja => "カット",
            Locale::ZhTw => "剪下",
            Locale::En => "Cut",
        },
        Key::Copy => match locale {
            Locale::Ja => "コピー",
            Locale::ZhTw => "拷貝",
            Locale::En => "Copy",
        },
        Key::Paste => match locale {
            Locale::Ja => "ペースト",
            Locale::ZhTw => "貼上",
            Locale::En => "Paste",
        },
        Key::SelectAll => match locale {
            Locale::Ja => "すべてを選択",
            Locale::ZhTw => "全選",
            Locale::En => "Select All",
        },
        Key::ViewMenu => match locale {
            Locale::Ja => "表示",
            Locale::ZhTw => "顯示方式",
            Locale::En => "View",
        },
        Key::Reload => match locale {
            Locale::Ja => "再読み込み",
            Locale::ZhTw => "重新載入",
            Locale::En => "Reload",
        },
        Key::FullScreen => match locale {
            Locale::Ja => "フルスクリーンにする",
            Locale::ZhTw => "進入全螢幕",
            Locale::En => "Enter Full Screen",
        },
        Key::WindowMenu => match locale {
            Locale::Ja => "ウィンドウ",
            Locale::ZhTw => "視窗",
            Locale::En => "Window",
        },
        Key::Minimize => match locale {
            Locale::Ja => "しまう",
            Locale::ZhTw => "縮到最小",
            Locale::En => "Minimize",
        },
        Key::Zoom => match locale {
            Locale::Ja => "拡大/縮小",
            Locale::ZhTw => "縮放",
            Locale::En => "Zoom",
        },
        Key::WinFileMenu => match locale {
            Locale::Ja => "ファイル(&F)",
            Locale::ZhTw => "檔案(&F)",
            Locale::En => "&File",
        },
        Key::WinEditMenu => match locale {
            Locale::Ja => "編集(&E)",
            Locale::ZhTw => "編輯(&E)",
            Locale::En => "&Edit",
        },
        Key::WinViewMenu => match locale {
            Locale::Ja => "表示(&V)",
            Locale::ZhTw => "檢視(&V)",
            Locale::En => "&View",
        },
        Key::WinHelpMenu => match locale {
            Locale::Ja => "ヘルプ(&H)",
            Locale::ZhTw => "說明(&H)",
            Locale::En => "&Help",
        },
        Key::WinPrint => match locale {
            Locale::Ja => "印刷(&P)…",
            Locale::ZhTw => "列印(&P)⋯",
            Locale::En => "&Print…",
        },
        Key::WinExit => match locale {
            Locale::Ja => "終了(&X)",
            Locale::ZhTw => "結束(&X)",
            Locale::En => "E&xit",
        },
        Key::WinReload => match locale {
            Locale::Ja => "再読み込み(&R)",
            Locale::ZhTw => "重新載入(&R)",
            Locale::En => "&Reload",
        },
        Key::WinFullScreen => match locale {
            Locale::Ja => "全画面表示(&U)",
            Locale::ZhTw => "全螢幕(&U)",
            Locale::En => "F&ull Screen",
        },
        Key::WinAbout => match locale {
            Locale::Ja => "aoiko について(&A)",
            Locale::ZhTw => "關於 aoiko(&A)",
            Locale::En => "&About aoiko",
        },
        Key::WinUndo => match locale {
            Locale::Ja => "元に戻す(&U)",
            Locale::ZhTw => "復原(&U)",
            Locale::En => "&Undo",
        },
        Key::WinRedo => match locale {
            Locale::Ja => "やり直し(&R)",
            Locale::ZhTw => "重做(&R)",
            Locale::En => "&Redo",
        },
        Key::WinCut => match locale {
            Locale::Ja => "切り取り(&T)",
            Locale::ZhTw => "剪下(&T)",
            Locale::En => "Cu&t",
        },
        Key::WinCopy => match locale {
            Locale::Ja => "コピー(&C)",
            Locale::ZhTw => "複製(&C)",
            Locale::En => "&Copy",
        },
        Key::WinPaste => match locale {
            Locale::Ja => "貼り付け(&P)",
            Locale::ZhTw => "貼上(&P)",
            Locale::En => "&Paste",
        },
        Key::WinSelectAll => match locale {
            Locale::Ja => "すべて選択(&A)",
            Locale::ZhTw => "全選(&A)",
            Locale::En => "Select &All",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{tr, Key, Locale};

    const LOCALES: [Locale; 3] = [Locale::Ja, Locale::ZhTw, Locale::En];
    const KEYS: [Key; 37] = [
        Key::About,
        Key::Services,
        Key::Hide,
        Key::HideOthers,
        Key::ShowAll,
        Key::Quit,
        Key::FileMenu,
        Key::Print,
        Key::CloseWindow,
        Key::EditMenu,
        Key::Undo,
        Key::Redo,
        Key::Cut,
        Key::Copy,
        Key::Paste,
        Key::SelectAll,
        Key::ViewMenu,
        Key::Reload,
        Key::FullScreen,
        Key::WindowMenu,
        Key::Minimize,
        Key::Zoom,
        Key::WinFileMenu,
        Key::WinEditMenu,
        Key::WinViewMenu,
        Key::WinHelpMenu,
        Key::WinPrint,
        Key::WinExit,
        Key::WinReload,
        Key::WinFullScreen,
        Key::WinAbout,
        Key::WinUndo,
        Key::WinRedo,
        Key::WinCut,
        Key::WinCopy,
        Key::WinPaste,
        Key::WinSelectAll,
    ];

    #[test]
    fn every_key_has_a_non_empty_string_in_every_locale() {
        for locale in LOCALES {
            for key in KEYS {
                assert!(
                    !tr(locale, key).trim().is_empty(),
                    "{key:?} が {locale:?} で空"
                );
            }
        }
    }

    /// 訳し忘れて日本語のまま置いた項目を拾う。同じ語が別言語で一致するのは
    /// 英語と繁體中文の綴りが同じになる場合だけで、この 37 項目には無い。
    #[test]
    fn no_locale_reuses_another_locales_string() {
        for key in KEYS {
            let ja = tr(Locale::Ja, key);
            let zh = tr(Locale::ZhTw, key);
            let en = tr(Locale::En, key);
            assert_ne!(ja, zh, "{key:?} の繁體中文が日本語のまま");
            assert_ne!(ja, en, "{key:?} の英語が日本語のまま");
            assert_ne!(zh, en, "{key:?} の英語が繁體中文のまま");
        }
    }

    /// タグは公開 repo の paraglide の locales と同じ綴りでなければ、
    /// web 側が渡してくる文字列と噛み合わない。
    #[test]
    fn tags_round_trip() {
        for locale in LOCALES {
            assert_eq!(Locale::from_tag(locale.tag()), Some(locale));
        }
        assert_eq!(Locale::from_tag("zh-Hant"), None);
        assert_eq!(Locale::from_tag(""), None);
    }
}
