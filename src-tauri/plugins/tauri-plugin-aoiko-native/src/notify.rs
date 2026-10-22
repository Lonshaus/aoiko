// 解析の完了通知と、解析中の「作業中」宣言のうち、OS に触れない部分。
//
// OS へ渡る値は列挙型と検証済みのジョブ識別子だけにする。通知の文面はこのファイルの固定表から
// 引き、JS から自由な文字列は受け取らない（ロック画面に出るため、金額や取引先を載せる経路を
// 作らない）。
//
// 実際に通知を出す環境は限られ、それ以外では表や台帳のほとんどが呼ばれない。
// 環境ごとに cfg で切ると、使わない側の検証がテストから漏れる。
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]
use std::collections::VecDeque;
use std::ffi::CStr;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Deserializer, Serialize};
/// 解析の種別。添字はネイティブ側の analysisKindName と揃える。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AnalysisKind {
    Receipt,
    Order,
    Classify,
}

impl AnalysisKind {
    pub(crate) fn index(self) -> i32 {
        match self {
            Self::Receipt => 0,
            Self::Order => 1,
            Self::Classify => 2,
        }
    }
    // OS から戻ってきた値は信用しない。知らない添字は None。
    pub(crate) fn from_index(index: i32) -> Option<Self> {
        match index {
            0 => Some(Self::Receipt),
            1 => Some(Self::Order),
            2 => Some(Self::Classify),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Done,
    Failed,
}
/// 通知の言語。タグは paraglide の locales と同じ綴り。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum UiLocale {
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-TW")]
    ZhTw,
}
/// 通知の許可状態。文字列は JS の NotificationPermission と同じ綴りに、非対応を足したもの。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotifyStatus {
    Unsupported,
    Default,
    Denied,
    Granted,
}

impl NotifyStatus {
    // ネイティブ側の 0 非対応 / 1 未決定 / 2 拒否 / 3 許可。知らない値は許可されていない扱い。
    pub(crate) fn from_code(code: i32) -> Self {
        match code {
            0 => Self::Unsupported,
            1 => Self::Default,
            3 => Self::Granted,
            _ => Self::Denied,
        }
    }
}
/// 通知の文面。題は常に固定で、本文は画面の名前と結果だけ。
pub(crate) struct Text {
    pub(crate) title: &'static CStr,
    pub(crate) body: &'static CStr,
}
// 本文は web 側の analysis_notify_done / analysis_notify_failed に画面の名前を入れたものと
// 同じ（messages/*.json との一致をテストで見ている）。
pub(crate) fn text(locale: UiLocale, kind: AnalysisKind, outcome: Outcome) -> Text {
    use AnalysisKind::{Classify, Order, Receipt};
    use Outcome::{Done, Failed};
    use UiLocale::{En, Ja, ZhTw};
    let body = match (locale, kind, outcome) {
        (Ja, Receipt, Done) => c"領収書の解析が終わりました",
        (Ja, Receipt, Failed) => c"領収書の解析に失敗しました",
        (Ja, Order, Done) => c"注文取込の解析が終わりました",
        (Ja, Order, Failed) => c"注文取込の解析に失敗しました",
        (Ja, Classify, Done) => c"インポートの解析が終わりました",
        (Ja, Classify, Failed) => c"インポートの解析に失敗しました",
        (En, Receipt, Done) => c"Receipts: analysis finished",
        (En, Receipt, Failed) => c"Receipts: analysis failed",
        (En, Order, Done) => c"Orders: analysis finished",
        (En, Order, Failed) => c"Orders: analysis failed",
        (En, Classify, Done) => c"Import: analysis finished",
        (En, Classify, Failed) => c"Import: analysis failed",
        (ZhTw, Receipt, Done) => c"「收據」解析完成",
        (ZhTw, Receipt, Failed) => c"「收據」解析失敗",
        (ZhTw, Order, Done) => c"「訂單匯入」解析完成",
        (ZhTw, Order, Failed) => c"「訂單匯入」解析失敗",
        (ZhTw, Classify, Done) => c"「匯入」解析完成",
        (ZhTw, Classify, Failed) => c"「匯入」解析失敗",
    };
    Text {
        title: c"aoiko",
        body,
    }
}
/// 解析 1 件を指す識別子。128 文字以下の英数字とハイフンだけ。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobId(String);

const JOB_ID_MAX_LEN: usize = 128;

impl JobId {
    pub(crate) fn parse(raw: &str) -> Option<Self> {
        let valid = !raw.is_empty()
            && raw.len() <= JOB_ID_MAX_LEN
            && raw.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        valid.then(|| Self(raw.to_string()))
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for JobId {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        // 不正な値をエラー文に写さない。
        Self::parse(&raw).ok_or_else(|| serde::de::Error::custom("ジョブの識別子が不正です"))
    }
}
/// OS の「作業中」宣言。0 は「始められなかった」を表し、保持しない。
pub(crate) trait ActivityBackend {
    fn begin(&self) -> u64;
    fn end(&self, handle: u64);
}
// 連続して保持できる合計時間。保持したまま一晩中スリープできなくなるのを防ぐ。
const MAX_HELD: Duration = Duration::from_secs(30 * 60);
// 何も保持していない時間がこれに届くと、上の合計を数え直す。
const IDLE_RESET: Duration = Duration::from_secs(60);
// 終えたジョブの識別子を覚えておく数。終了が開始より先に届いても、開始を無視できる。
const ENDED_MEMORY: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BeginOutcome {
    Started,
    /// 終えたはずのジョブへの開始。何もしない。
    Ignored,
    /// 上限を使い切っている、または OS が始めさせなかった。
    Refused,
}

struct Held {
    job: JobId,
    handle: u64,
    since: Instant,
}

#[derive(Default)]
struct State {
    held: Option<Held>,
    ended: VecDeque<String>,
    // 保持し終えた分の合計。保持している最中の分は含まない。
    spent: Duration,
    idle_since: Option<Instant>,
}

impl State {
    fn remember(&mut self, job: &str) {
        if self.ended.iter().any(|seen| seen == job) {
            return;
        }
        if self.ended.len() >= ENDED_MEMORY {
            self.ended.pop_front();
        }
        self.ended.push_back(job.to_string());
    }

    fn stop_held<B: ActivityBackend>(&mut self, backend: &B, now: Instant) {
        let Some(held) = self.held.take() else {
            return;
        };
        backend.end(held.handle);
        self.spent += now.saturating_duration_since(held.since);
        self.idle_since = Some(now);
        self.remember(held.job.as_str());
    }
}
/// 解析中に OS へ出す「作業中」宣言の台帳。同時に保持するのは 1 件だけ。
///
/// 時刻は呼び出し側が渡す。ロックは OS の呼び出しの間も保持し続ける（開始と終了の順序を
/// 入れ替えさせない）。
pub(crate) struct ActivityTokens<B> {
    backend: B,
    state: Mutex<State>,
}

impl<B: ActivityBackend> ActivityTokens<B> {
    pub(crate) fn new(backend: B) -> Self {
        Self {
            backend,
            state: Mutex::new(State::default()),
        }
    }
    // 先に保持しているものは必ず終えてから始める（解析は 1 件ずつ）。
    pub(crate) fn begin(&self, job: &JobId, now: Instant) -> BeginOutcome {
        let Ok(mut state) = self.state.lock() else {
            return BeginOutcome::Refused;
        };
        if state.ended.iter().any(|seen| seen == job.as_str()) {
            return BeginOutcome::Ignored;
        }
        state.stop_held(&self.backend, now);
        if let Some(since) = state.idle_since {
            if now.saturating_duration_since(since) >= IDLE_RESET {
                state.spent = Duration::ZERO;
                state.idle_since = None;
            }
        }
        if state.spent >= MAX_HELD {
            return BeginOutcome::Refused;
        }
        let handle = self.backend.begin();
        if handle == 0 {
            return BeginOutcome::Refused;
        }
        state.idle_since = None;
        state.held = Some(Held {
            job: job.clone(),
            handle,
            since: now,
        });
        BeginOutcome::Started
    }
    // 保持していないジョブの終了も覚える。開始より先に終了が届いた場合に、後から来る開始を無視するため。
    pub(crate) fn end(&self, job: &JobId, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.held.as_ref().is_some_and(|held| &held.job == job) {
            state.stop_held(&self.backend, now);
        } else {
            state.remember(job.as_str());
        }
    }

    pub(crate) fn end_all(&self, now: Instant) {
        if let Ok(mut state) = self.state.lock() {
            state.stop_held(&self.backend, now);
        }
    }
    // 呼び出し側が忘れても、合計が上限に届いた宣言は手放す。
    pub(crate) fn sweep(&self, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let Some(held) = state.held.as_ref() else {
            return;
        };
        if state.spent + now.saturating_duration_since(held.since) >= MAX_HELD {
            state.stop_held(&self.backend, now);
        }
    }

    #[cfg(test)]
    fn held_job(&self) -> Option<String> {
        let state = self.state.lock().ok()?;
        state
            .held
            .as_ref()
            .map(|held| held.job.as_str().to_string())
    }
}
/// この環境に「作業中」宣言の仕組みが無いときの代わり。何も始めない。
#[cfg(not(target_os = "macos"))]
pub(crate) struct NoActivity;

#[cfg(not(target_os = "macos"))]
impl ActivityBackend for NoActivity {
    fn begin(&self) -> u64 {
        0
    }

    fn end(&self, _handle: u64) {}
}

#[cfg(target_os = "macos")]
pub(crate) type Tokens = ActivityTokens<crate::desktop::analysis_notify::SystemActivity>;
#[cfg(not(target_os = "macos"))]
pub(crate) type Tokens = ActivityTokens<NoActivity>;

#[cfg(target_os = "macos")]
pub(crate) fn platform_activity() -> crate::desktop::analysis_notify::SystemActivity {
    crate::desktop::analysis_notify::SystemActivity
}
#[cfg(not(target_os = "macos"))]
pub(crate) fn platform_activity() -> NoActivity {
    NoActivity
}

type OpenEmitter = Box<dyn Fn(AnalysisKind) + Send + Sync>;
// コールバックは C の関数ポインタで、ジェネリックなアプリのハンドルを持てない。
// 一度だけ置いて、以降は読むだけにする。
static OPEN_EMITTER: OnceLock<OpenEmitter> = OnceLock::new();

pub(crate) fn set_open_emitter(emit: OpenEmitter) {
    let _ = OPEN_EMITTER.set(emit);
}
// 知らない添字は何もせず戻る。
pub(crate) fn forward_open(index: i32, emit: &dyn Fn(AnalysisKind)) {
    let Some(kind) = AnalysisKind::from_index(index) else {
        return;
    };
    emit(kind);
}
// panic を C の呼び出し元まで伝えない。
pub(crate) fn open_guarded(index: i32, emit: &dyn Fn(AnalysisKind)) {
    let _ = catch_unwind(AssertUnwindSafe(|| forward_open(index, emit)));
}

pub(crate) fn dispatch_open(index: i32) {
    if let Some(emit) = OPEN_EMITTER.get() {
        open_guarded(index, emit.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashSet;
    use std::sync::Arc;

    const KINDS: [AnalysisKind; 3] = [
        AnalysisKind::Receipt,
        AnalysisKind::Order,
        AnalysisKind::Classify,
    ];
    const OUTCOMES: [Outcome; 2] = [Outcome::Done, Outcome::Failed];
    const LOCALES: [UiLocale; 3] = [UiLocale::Ja, UiLocale::En, UiLocale::ZhTw];

    fn parse<T: serde::de::DeserializeOwned>(raw: &str) -> Result<T, serde_json::Error> {
        serde_json::from_str(&format!("\"{raw}\""))
    }

    #[test]
    fn kind_accepts_only_the_three_fixed_values() {
        assert_eq!(
            parse::<AnalysisKind>("receipt").unwrap(),
            AnalysisKind::Receipt
        );
        assert_eq!(parse::<AnalysisKind>("order").unwrap(), AnalysisKind::Order);
        assert_eq!(
            parse::<AnalysisKind>("classify").unwrap(),
            AnalysisKind::Classify
        );
        for bad in [
            "",
            "Receipt",
            "RECEIPT",
            "/receipt",
            "constructor",
            "receipt ",
            "all",
        ] {
            assert!(parse::<AnalysisKind>(bad).is_err(), "{bad}");
        }
        assert!(serde_json::from_str::<AnalysisKind>("1").is_err());
        assert!(serde_json::from_str::<AnalysisKind>("null").is_err());
    }

    #[test]
    fn outcome_accepts_only_done_and_failed() {
        assert_eq!(parse::<Outcome>("done").unwrap(), Outcome::Done);
        assert_eq!(parse::<Outcome>("failed").unwrap(), Outcome::Failed);
        for bad in ["", "cancelled", "Done", "success", "done "] {
            assert!(parse::<Outcome>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn locale_accepts_only_the_three_fixed_tags() {
        assert_eq!(parse::<UiLocale>("ja").unwrap(), UiLocale::Ja);
        assert_eq!(parse::<UiLocale>("en").unwrap(), UiLocale::En);
        assert_eq!(parse::<UiLocale>("zh-TW").unwrap(), UiLocale::ZhTw);
        for bad in ["", "zh", "zh-tw", "zh_TW", "EN", "ja-JP", "fr"] {
            assert!(parse::<UiLocale>(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn kind_index_round_trips_and_rejects_unknown_values() {
        for kind in KINDS {
            assert_eq!(AnalysisKind::from_index(kind.index()), Some(kind));
        }
        for bad in [-1, 3, 4, 100, i32::MAX, i32::MIN] {
            assert_eq!(AnalysisKind::from_index(bad), None, "{bad}");
        }
    }

    #[test]
    fn status_codes_map_and_unknown_codes_are_not_granted() {
        assert_eq!(NotifyStatus::from_code(0), NotifyStatus::Unsupported);
        assert_eq!(NotifyStatus::from_code(1), NotifyStatus::Default);
        assert_eq!(NotifyStatus::from_code(2), NotifyStatus::Denied);
        assert_eq!(NotifyStatus::from_code(3), NotifyStatus::Granted);
        for bad in [-1, 4, 99] {
            assert_eq!(NotifyStatus::from_code(bad), NotifyStatus::Denied, "{bad}");
        }
        let json = |s| serde_json::to_string(&s).unwrap();
        assert_eq!(json(NotifyStatus::Unsupported), "\"unsupported\"");
        assert_eq!(json(NotifyStatus::Default), "\"default\"");
        assert_eq!(json(NotifyStatus::Denied), "\"denied\"");
        assert_eq!(json(NotifyStatus::Granted), "\"granted\"");
    }

    #[test]
    fn every_locale_kind_and_outcome_has_distinct_fixed_text() {
        let mut seen = HashSet::new();
        for locale in LOCALES {
            for kind in KINDS {
                for outcome in OUTCOMES {
                    let t = text(locale, kind, outcome);
                    assert_eq!(t.title.to_str().unwrap(), "aoiko");
                    let body = t.body.to_str().unwrap();
                    assert!(!body.is_empty());
                    assert!(seen.insert(body), "{body}");
                }
            }
        }
        assert_eq!(seen.len(), 18);
    }

    #[test]
    fn text_is_fixed_and_has_no_placeholder_or_control_character() {
        for locale in LOCALES {
            for kind in KINDS {
                for outcome in OUTCOMES {
                    let body = text(locale, kind, outcome).body.to_str().unwrap();
                    assert!(
                        !body
                            .chars()
                            .any(|c| c.is_control() || "{}%$\\<>&".contains(c)),
                        "{body}"
                    );
                    assert!(!body.chars().any(|c| c.is_ascii_digit()), "{body}");
                }
            }
        }
    }
    // web 側で同じ通知を出す analysis_notify_done / analysis_notify_failed と食い違わないこと。
    #[test]
    fn text_matches_the_catalog_the_web_side_uses() {
        let catalogs = [
            (UiLocale::Ja, include_str!("../../../../messages/ja.json")),
            (UiLocale::En, include_str!("../../../../messages/en.json")),
            (
                UiLocale::ZhTw,
                include_str!("../../../../messages/zh-TW.json"),
            ),
        ];
        let names = [
            (AnalysisKind::Receipt, "nav_receipt"),
            (AnalysisKind::Order, "nav_order_import"),
            (AnalysisKind::Classify, "nav_import"),
        ];
        for (locale, source) in catalogs {
            let catalog: serde_json::Value = serde_json::from_str(source).unwrap();
            let entry = |key: &str| catalog[key].as_str().unwrap().to_string();
            for (kind, name_key) in names {
                let name = entry(name_key);
                let done = entry("analysis_notify_done").replace("{name}", &name);
                let failed = entry("analysis_notify_failed").replace("{name}", &name);
                assert_eq!(
                    text(locale, kind, Outcome::Done).body.to_str().unwrap(),
                    done
                );
                assert_eq!(
                    text(locale, kind, Outcome::Failed).body.to_str().unwrap(),
                    failed
                );
                assert_eq!(
                    text(locale, kind, Outcome::Done).title.to_str().unwrap(),
                    entry("app_name")
                );
            }
        }
    }

    #[test]
    fn job_id_accepts_alphanumerics_and_hyphens_up_to_128() {
        assert!(JobId::parse("a").is_some());
        assert!(JobId::parse("3f2b8c1e-aaaa-4bbb-8ccc-0123456789ab-12").is_some());
        assert!(JobId::parse(&"a".repeat(128)).is_some());
    }

    #[test]
    fn job_id_rejects_empty_over_long_and_other_characters() {
        assert!(JobId::parse("").is_none());
        assert!(JobId::parse(&"a".repeat(129)).is_none());
        for bad in [
            "a b",
            "a_b",
            "a/b",
            "a.b",
            "a:b",
            "a\n",
            "\0",
            "日本語",
            "a;b",
            "a\"b",
            "é",
        ] {
            assert!(JobId::parse(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn job_id_is_validated_when_deserialized() {
        assert!(serde_json::from_str::<JobId>("\"abc-123\"").is_ok());
        assert!(serde_json::from_str::<JobId>("\"abc 123\"").is_err());
        assert!(serde_json::from_str::<JobId>("\"\"").is_err());
        assert!(serde_json::from_str::<JobId>("1").is_err());
        let long = format!("\"{}\"", "a".repeat(129));
        assert!(serde_json::from_str::<JobId>(&long).is_err());
    }

    #[test]
    fn rejected_job_id_is_not_echoed_in_the_error() {
        let err = serde_json::from_str::<JobId>("\"secret value\"").unwrap_err();
        assert!(!err.to_string().contains("secret"));
    }

    #[derive(Default)]
    struct FakeBackend {
        next: Mutex<u64>,
        live: Mutex<HashSet<u64>>,
        refuse: Mutex<bool>,
    }

    impl FakeBackend {
        fn live(&self) -> usize {
            self.live.lock().unwrap().len()
        }
    }

    impl ActivityBackend for Arc<FakeBackend> {
        fn begin(&self) -> u64 {
            if *self.refuse.lock().unwrap() {
                return 0;
            }
            let mut next = self.next.lock().unwrap();
            *next += 1;
            self.live.lock().unwrap().insert(*next);
            *next
        }

        fn end(&self, handle: u64) {
            self.live.lock().unwrap().remove(&handle);
        }
    }

    fn job(raw: &str) -> JobId {
        JobId::parse(raw).unwrap()
    }

    fn setup() -> (Arc<FakeBackend>, ActivityTokens<Arc<FakeBackend>>, Instant) {
        let backend = Arc::new(FakeBackend::default());
        (
            backend.clone(),
            ActivityTokens::new(backend),
            Instant::now(),
        )
    }

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn begin_ends_the_previous_token_first() {
        let (backend, tokens, t0) = setup();
        assert_eq!(tokens.begin(&job("a"), t0), BeginOutcome::Started);
        assert_eq!(tokens.begin(&job("b"), t0 + secs(1)), BeginOutcome::Started);
        assert_eq!(backend.live(), 1);
        assert_eq!(tokens.held_job().as_deref(), Some("b"));
    }

    #[test]
    fn end_ends_only_its_own_token() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.end(&job("other"), t0 + secs(1));
        assert_eq!(backend.live(), 1);
        assert_eq!(tokens.held_job().as_deref(), Some("a"));
        tokens.end(&job("a"), t0 + secs(2));
        assert_eq!(backend.live(), 0);
        assert_eq!(tokens.held_job(), None);
    }

    #[test]
    fn end_all_ends_everything() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.end_all(t0 + secs(1));
        assert_eq!(backend.live(), 0);
        tokens.end_all(t0 + secs(2));
        assert_eq!(backend.live(), 0);
    }

    #[test]
    fn end_before_begin_leaves_no_token() {
        let (backend, tokens, t0) = setup();
        tokens.end(&job("a"), t0);
        assert_eq!(tokens.begin(&job("a"), t0 + secs(1)), BeginOutcome::Ignored);
        assert_eq!(backend.live(), 0);
        assert_eq!(tokens.held_job(), None);
    }

    #[test]
    fn begin_after_end_all_for_an_old_id_leaves_no_token() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.end_all(t0 + secs(1));
        assert_eq!(tokens.begin(&job("a"), t0 + secs(2)), BeginOutcome::Ignored);
        assert_eq!(backend.live(), 0);
        assert_eq!(tokens.begin(&job("b"), t0 + secs(3)), BeginOutcome::Started);
        assert_eq!(backend.live(), 1);
    }

    #[test]
    fn a_job_replaced_by_the_next_begin_cannot_begin_again() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.begin(&job("b"), t0 + secs(1));
        assert_eq!(tokens.begin(&job("a"), t0 + secs(2)), BeginOutcome::Ignored);
        assert_eq!(tokens.held_job().as_deref(), Some("b"));
        assert_eq!(backend.live(), 1);
    }

    #[test]
    fn only_the_last_32_ended_ids_are_remembered() {
        let (_backend, tokens, t0) = setup();
        for n in 0..33 {
            tokens.end(&job(&format!("j{n}")), t0);
        }
        assert_eq!(tokens.begin(&job("j0"), t0), BeginOutcome::Started);
        assert_eq!(tokens.begin(&job("j32"), t0), BeginOutcome::Ignored);
        assert_eq!(tokens.begin(&job("j1"), t0), BeginOutcome::Ignored);
    }

    #[test]
    fn a_backend_that_does_not_start_leaves_no_token() {
        let (backend, tokens, t0) = setup();
        *backend.refuse.lock().unwrap() = true;
        assert_eq!(tokens.begin(&job("a"), t0), BeginOutcome::Refused);
        assert_eq!(tokens.held_job(), None);
    }

    #[test]
    fn sweep_ends_a_token_only_once_the_cap_is_reached() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.sweep(t0 + secs(30 * 60 - 1));
        assert_eq!(backend.live(), 1);
        tokens.sweep(t0 + secs(30 * 60));
        assert_eq!(backend.live(), 0);
        assert_eq!(tokens.held_job(), None);
    }

    #[test]
    fn the_cap_is_cumulative_across_consecutive_begins() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.begin(&job("b"), t0 + secs(20 * 60));
        tokens.sweep(t0 + secs(29 * 60));
        assert_eq!(backend.live(), 1);
        tokens.sweep(t0 + secs(30 * 60));
        assert_eq!(backend.live(), 0);
    }

    #[test]
    fn a_spent_cap_refuses_begin_until_a_60_second_idle_gap() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        let spent_at = t0 + secs(30 * 60);
        tokens.sweep(spent_at);
        assert_eq!(
            tokens.begin(&job("b"), spent_at + secs(1)),
            BeginOutcome::Refused
        );
        assert_eq!(
            tokens.begin(&job("c"), spent_at + secs(59)),
            BeginOutcome::Refused
        );
        assert_eq!(backend.live(), 0);
        assert_eq!(
            tokens.begin(&job("d"), spent_at + secs(60)),
            BeginOutcome::Started
        );
        assert_eq!(backend.live(), 1);
    }

    #[test]
    fn a_short_idle_gap_does_not_reset_the_cumulative_total() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.end(&job("a"), t0 + secs(25 * 60));
        tokens.begin(&job("b"), t0 + secs(25 * 60 + 30));
        tokens.sweep(t0 + secs(25 * 60 + 30 + 5 * 60));
        assert_eq!(backend.live(), 0);
    }

    #[test]
    fn a_long_idle_gap_resets_the_cumulative_total() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0);
        tokens.end(&job("a"), t0 + secs(25 * 60));
        let later = t0 + secs(25 * 60 + 60);
        assert_eq!(tokens.begin(&job("b"), later), BeginOutcome::Started);
        tokens.sweep(later + secs(29 * 60));
        assert_eq!(backend.live(), 1);
    }

    #[test]
    fn a_time_going_backwards_does_not_panic() {
        let (backend, tokens, t0) = setup();
        tokens.begin(&job("a"), t0 + secs(10));
        tokens.sweep(t0);
        tokens.end(&job("a"), t0);
        assert_eq!(backend.live(), 0);
    }

    #[test]
    fn open_ignores_unknown_indices() {
        let seen = RefCell::new(Vec::new());
        for bad in [-1, 3, 7, i32::MAX, i32::MIN] {
            forward_open(bad, &|kind| seen.borrow_mut().push(kind));
            open_guarded(bad, &|kind| seen.borrow_mut().push(kind));
        }
        assert!(seen.borrow().is_empty());
    }

    #[test]
    fn open_forwards_each_known_kind() {
        let seen = RefCell::new(Vec::new());
        for index in 0..3 {
            open_guarded(index, &|kind| seen.borrow_mut().push(kind));
        }
        assert_eq!(*seen.borrow(), KINDS.to_vec());
    }

    #[test]
    fn a_panic_inside_the_open_callback_does_not_unwind_out() {
        let outcome = catch_unwind(|| open_guarded(0, &|_| panic!("boom")));
        assert!(outcome.is_ok());
    }

    #[test]
    fn dispatch_without_an_emitter_does_nothing() {
        dispatch_open(0);
        dispatch_open(99);
    }
    // ネイティブ側の AnalysisNotify は実行時に OS を呼ぶため、ここでは書かれ方だけを固定する。
    fn native_source() -> &'static str {
        include_str!("../ios/Sources/AoikoNativePlugin/AnalysisNotify.swift")
    }

    #[test]
    fn native_activity_reason_is_the_fixed_constant() {
        let source = native_source();
        assert!(source.contains("private let activityReason = \"aoiko analysis\""));
        assert!(source.contains("reason: activityReason"));
        assert_eq!(source.matches("reason:").count(), 1);
        assert!(source.contains("options: .userInitiated"));
    }

    #[test]
    fn native_kind_mapping_matches_the_rust_enum() {
        let source = native_source();
        for kind in KINDS {
            let name = match kind {
                AnalysisKind::Receipt => "receipt",
                AnalysisKind::Order => "order",
                AnalysisKind::Classify => "classify",
            };
            let index = kind.index();
            assert!(
                source.contains(&format!("case {index}: return \"{name}\"")),
                "{name}"
            );
            assert!(
                source.contains(&format!("case \"{name}\": return {index}")),
                "{name}"
            );
        }
        assert_eq!(source.matches("case 3:").count(), 0);
    }

    #[test]
    fn native_acts_on_the_default_tap_only() {
        let source = native_source();
        assert!(
            source.contains("response.actionIdentifier == UNNotificationDefaultActionIdentifier")
        );
        assert_eq!(source.matches("completionHandler(").count(), 2);
        assert!(source.contains("defer { completionHandler() }"));
    }

    #[test]
    fn native_has_no_main_actor_and_sets_only_the_fixed_content_fields() {
        let source = native_source();
        assert!(!source.contains("@MainActor"));
        for field in [
            "content.subtitle",
            "content.attachments",
            "content.threadIdentifier",
            "content.categoryIdentifier",
            "content.sound",
            "content.badge",
        ] {
            assert!(!source.contains(field), "{field}");
        }
        assert!(source.contains("content.title = String(cString: title)"));
        assert!(source.contains("content.body = String(cString: body)"));
        assert!(source.contains("content.userInfo = [\"kind\": name]"));
        assert!(source.contains("identifier: \"aoiko-analysis-\\(name)\""));
    }

    #[test]
    fn native_guards_every_entry_and_never_holds_the_center_in_a_global() {
        let source = native_source();
        assert!(source.contains("private let runningAsAppBundle = isAppBundle("));
        assert!(!source.contains("let center"));
        assert!(!source.contains("var center"));
        let center_uses = source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .filter(|line| line.contains("UNUserNotificationCenter.current()"))
            .count();
        assert_eq!(center_uses, 4);
        for entry in [
            "func currentStatus()",
            "func aoiko_notify_request()",
            "func aoiko_notify_post(",
            "func aoiko_notify_set_open_handler(",
        ] {
            let body = source.split(entry).nth(1).expect(entry);
            let head: String = body.lines().take(8).collect::<Vec<_>>().join("\n");
            assert!(head.contains("guard runningAsAppBundle"), "{entry}");
        }
    }

    #[test]
    fn native_waits_are_bounded_and_off_the_main_thread() {
        let source = native_source();
        assert!(source.contains("private let statusWaitSeconds: TimeInterval = 5"));
        assert!(source.contains("private let requestWaitSeconds: TimeInterval = 300"));
        assert!(source.contains("private let postWaitSeconds: TimeInterval = 5"));
        assert_eq!(source.matches("done.wait(").count(), 3);
        assert_eq!(source.matches("!Thread.isMainThread").count(), 3);
    }

    #[test]
    fn ios_does_not_reference_the_desktop_only_symbols() {
        let source = include_str!("ios.rs");
        assert!(!source.contains("aoiko_notify_"));
        assert!(!source.contains("aoiko_activity_"));
    }
}
