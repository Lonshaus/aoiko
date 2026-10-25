// iOS で LLM の解析を web view の外（アプリのプロセス）で走らせる部分のうち、OS に触れない側。
//
// web view は裏に回ると止められるので、解析の本体（runner.js）を Swift の JSContext で動かし、
// 通信はこのファイルの検査を通してアプリ側の HTTP クライアントへ回す。JS から受け取るのはデータだけの
// 仕様（spec）で、ここで全項目を検査してから Swift へ渡す。拒否の理由は固定のコードで返し、入力の文字列を
// 写さない。API キーは Debug も Display も持たない型に包み、ネイティブ側へ渡し終えたら手放す。
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]
use std::collections::{HashMap, VecDeque};
use std::ffi::{c_char, CString};
use std::future::Future;
use std::io::Write;
use std::pin::Pin;
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use tauri::Url;

use crate::commands::{
    check_apple_ai_payload_len, APPLE_AI_DATA_CEILING_BYTES, APPLE_AI_IMAGE_CEILING_BYTES,
};
use crate::notify::{self, AnalysisKind, JobId, NotifyStatus, Outcome, UiLocale};
// 上限はどれも従来の経路が受け取れる値を下回らない（file-limit.ts の値から導く）。
pub(crate) const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
pub(crate) const MAX_IMAGE_BASE64_LEN: usize = (MAX_IMAGE_BYTES * 4).div_ceil(3) + 4;
pub(crate) const MAX_CSV_BYTES: usize = 50 * 1024 * 1024;
pub(crate) const MAX_ORDER_TEXT_BYTES: usize = MAX_CSV_BYTES;
// 従来の分類は借方・貸方の側ごとに 1 グループずつ作る。
pub(crate) const MAX_CLASSIFY_GROUPS: usize = 2;
pub(crate) const MAX_CLASSIFY_GROUPS_BYTES: usize = 2 * MAX_CSV_BYTES;
pub(crate) const MAX_MODEL_CHARS: usize = 256;
pub(crate) const MAX_API_KEY_CHARS: usize = 4096;
pub(crate) const MAX_BASE_URL_CHARS: usize = 2048;
pub(crate) const MAX_MIME_TYPE_CHARS: usize = 255;
pub(crate) const MAX_SPEC_BYTES: usize = 200 * 1024 * 1024;
pub(crate) const MAX_RESULT_BYTES: usize = 64 * 1024 * 1024;
/// 通信 1 回ぶんの応答本文の上限。超えた応答は通信の失敗として扱う。
pub const MAX_RESPONSE_BODY_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const MAX_MESSAGE_CHARS: usize = 2000;
// Gemini の宛先は固定。モデル名は URL の path に入る。
const GEMINI_ORIGIN: &str = "https://generativelanguage.googleapis.com";
// 終えたジョブの識別子を覚えておく数（notify.rs の台帳と同じ考え方）。
const TOMBSTONE_MEMORY: usize = 32;
// take の待ちは条件を見直す間隔ごとに起きる。取りこぼした合図があっても止まり続けない。
const TAKE_RECHECK: Duration = Duration::from_secs(1);
/// 開始時の拒否。入力から作った文字列は持たない。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StartError {
    StartFailed,
    DisallowedUrl,
    // 端末内のエンジンで、アプリのプロセスで扱わない画像（大きすぎる・Wasm が使えない）。web view の経路へ戻す。
    UseWebview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Engine {
    Gemini,
    OpenaiCompatible,
    Tesseract,
    Native,
    AppleAi,
}

impl Engine {
    fn is_llm(self) -> bool {
        matches!(self, Engine::Gemini | Engine::OpenaiCompatible)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Side {
    Debit,
    Credit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AccountCategory {
    Asset,
    Liability,
    Equity,
    Revenue,
    Expense,
}
/// API キー。Debug と Display を持たせない（ログやエラー文へ流れる経路を型で塞ぐ）。
pub(crate) struct ApiKey(String);

impl<'de> Deserialize<'de> for ApiKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(ApiKey)
    }
}

impl Serialize for ApiKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.0)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AdapterSpec {
    model: String,
    #[serde(rename = "apiKey")]
    api_key: ApiKey,
    #[serde(rename = "baseUrl", default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ImageInput {
    base64: String,
    #[serde(rename = "mimeType")]
    mime_type: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ReceiptInput {
    image: ImageInput,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OrderInput {
    text: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ClassifyRow {
    #[serde(rename = "ref")]
    reference: String,
    description: String,
    amount: String,
}
// プロンプトが使う項目だけを写した科目。
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CandidateAccount {
    code: String,
    name: String,
    category: AccountCategory,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ClassifyOptions {
    #[serde(rename = "knownAccountCode")]
    known_account_code: String,
    #[serde(rename = "knownSide")]
    known_side: Side,
    #[serde(rename = "candidateAccounts")]
    candidate_accounts: Vec<CandidateAccount>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ClassifyGroup {
    #[serde(rename = "knownSide")]
    known_side: Side,
    inputs: Vec<ClassifyRow>,
    options: ClassifyOptions,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ClassifyInput {
    groups: Vec<ClassifyGroup>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Input {
    Receipt(ReceiptInput),
    Order(OrderInput),
    Classify(ClassifyInput),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSpec {
    job: String,
    kind: AnalysisKind,
    engine: Engine,
    locale: UiLocale,
    notify: bool,
    #[serde(default)]
    adapter: Option<AdapterSpec>,
    input: Value,
}
/// 検査済みの仕様。Swift へ渡す JSON はこの型から作り直す（知らない項目は残らない）。
#[derive(Serialize)]
pub(crate) struct Spec {
    job: String,
    kind: AnalysisKind,
    engine: Engine,
    #[serde(serialize_with = "serialize_locale")]
    locale: UiLocale,
    notify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    adapter: Option<AdapterSpec>,
    input: Input,
}

fn serialize_locale<S: Serializer>(locale: &UiLocale, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(match locale {
        UiLocale::Ja => "ja",
        UiLocale::En => "en",
        UiLocale::ZhTw => "zh-TW",
    })
}
/// 検査を通った仕様から、走らせている間に要るものだけを取り出したもの。
/// origin は LLM の宛先。端末内のエンジンには無く、そのジョブの通信はすべて断る。
pub(crate) struct Validated {
    pub(crate) spec: Spec,
    pub(crate) job: JobId,
    pub(crate) origin: Option<String>,
}
// 書き出しの大きさだけを数える。上限を超えた時点で書き出しを打ち切る。
struct ByteCounter {
    count: usize,
    limit: usize,
}

impl Write for ByteCounter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.count = self.count.saturating_add(buf.len());
        if self.count > self.limit {
            return Err(std::io::Error::other("over"));
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn serialized_within<T: Serialize + ?Sized>(value: &T, limit: usize) -> bool {
    let mut counter = ByteCounter { count: 0, limit };
    serde_json::to_writer(&mut counter, value).is_ok()
}

fn chars_within(s: &str, max: usize) -> bool {
    s.chars().nth(max).is_none()
}
// モデル名は URL の path に入るので、Gemini だけ文字の種類を絞る。
fn gemini_model_ok(model: &str) -> bool {
    model
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-'))
}

fn validate_input(kind: AnalysisKind, input: Value) -> Result<Input, StartError> {
    match kind {
        AnalysisKind::Receipt => {
            let input: ReceiptInput =
                serde_json::from_value(input).map_err(|_| StartError::StartFailed)?;
            let image = &input.image;
            if image.base64.is_empty()
                || image.base64.len() > MAX_IMAGE_BASE64_LEN
                || image.mime_type.is_empty()
                || !chars_within(&image.mime_type, MAX_MIME_TYPE_CHARS)
                || image.mime_type.chars().any(char::is_control)
            {
                return Err(StartError::StartFailed);
            }
            Ok(Input::Receipt(input))
        }
        AnalysisKind::Order => {
            let input: OrderInput =
                serde_json::from_value(input).map_err(|_| StartError::StartFailed)?;
            if input.text.len() > MAX_ORDER_TEXT_BYTES {
                return Err(StartError::StartFailed);
            }
            Ok(Input::Order(input))
        }
        AnalysisKind::Classify => {
            let input: ClassifyInput =
                serde_json::from_value(input).map_err(|_| StartError::StartFailed)?;
            let sides_agree = input
                .groups
                .iter()
                .all(|group| group.known_side == group.options.known_side);
            if input.groups.is_empty()
                || input.groups.len() > MAX_CLASSIFY_GROUPS
                || !sides_agree
                || !serialized_within(&input.groups, MAX_CLASSIFY_GROUPS_BYTES)
            {
                return Err(StartError::StartFailed);
            }
            Ok(Input::Classify(input))
        }
    }
}
/// 仕様を検査し、通信を許す唯一の宛先（origin）を決める。URL の可否はアプリ側の判定に委ねる。
pub(crate) fn validate(
    raw: Value,
    url_allowed: &dyn Fn(&str) -> bool,
) -> Result<Validated, StartError> {
    if !serialized_within(&raw, MAX_SPEC_BYTES) {
        return Err(StartError::StartFailed);
    }
    let raw: RawSpec = serde_json::from_value(raw).map_err(|_| StartError::StartFailed)?;
    let job = JobId::parse(&raw.job).ok_or(StartError::StartFailed)?;
    let origin = match (&raw.adapter, raw.engine.is_llm()) {
        (Some(adapter), true) => Some(llm_origin(raw.engine, adapter, url_allowed)?),
        (None, false) if local_pair_allowed(raw.kind, raw.engine) => None,
        _ => return Err(StartError::StartFailed),
    };
    let input = validate_input(raw.kind, raw.input)?;
    Ok(Validated {
        spec: Spec {
            job: raw.job,
            kind: raw.kind,
            engine: raw.engine,
            locale: raw.locale,
            notify: raw.notify,
            adapter: raw.adapter,
            input,
        },
        job,
        origin,
    })
}
// 端末内のエンジンが受け持つ組み合わせ。文字認識の 2 つは領収書だけ、OS の AI は 3 種類とも。
fn local_pair_allowed(kind: AnalysisKind, engine: Engine) -> bool {
    match engine {
        Engine::Tesseract | Engine::Native => kind == AnalysisKind::Receipt,
        Engine::AppleAi => true,
        Engine::Gemini | Engine::OpenaiCompatible => false,
    }
}

fn llm_origin(
    engine: Engine,
    adapter: &AdapterSpec,
    url_allowed: &dyn Fn(&str) -> bool,
) -> Result<String, StartError> {
    if adapter.model.is_empty()
        || !chars_within(&adapter.model, MAX_MODEL_CHARS)
        || !chars_within(&adapter.api_key.0, MAX_API_KEY_CHARS)
    {
        return Err(StartError::StartFailed);
    }
    match engine {
        Engine::Gemini => {
            if adapter.base_url.is_some() || !gemini_model_ok(&adapter.model) {
                return Err(StartError::StartFailed);
            }
            Ok(GEMINI_ORIGIN.to_string())
        }
        Engine::OpenaiCompatible => {
            let base = adapter.base_url.as_deref().ok_or(StartError::StartFailed)?;
            if base.is_empty() || !chars_within(base, MAX_BASE_URL_CHARS) {
                return Err(StartError::StartFailed);
            }
            let url = Url::parse(base).map_err(|_| StartError::StartFailed)?;
            if !url.username().is_empty() || url.password().is_some() {
                return Err(StartError::StartFailed);
            }
            if !url_allowed(base) {
                return Err(StartError::DisallowedUrl);
            }
            let origin = url.origin();
            if !origin.is_tuple() {
                return Err(StartError::StartFailed);
            }
            Ok(origin.ascii_serialization())
        }
        Engine::Tesseract | Engine::Native | Engine::AppleAi => Err(StartError::StartFailed),
    }
}
/// 分類で、失敗や取消しの前に終わっていたグループの提案。
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Partial {
    group: u8,
    suggestions: Vec<Value>,
}
/// 開始後の失敗の理由。文字列を持つのは llm と error だけで、どちらも runner.js が作った文言。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum RunnerFailure {
    Llm {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status: Option<u16>,
    },
    Connection,
    Error {
        message: String,
    },
    Expired,
    InvalidResult,
}
/// take が返す唯一の形。
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "outcome", rename_all = "lowercase")]
pub enum TakeResult {
    Done {
        result: Map<String, Value>,
    },
    Failed {
        error: RunnerFailure,
        #[serde(skip_serializing_if = "Option::is_none")]
        partial: Option<Vec<Partial>>,
    },
    Cancelled {
        #[serde(skip_serializing_if = "Option::is_none")]
        partial: Option<Vec<Partial>>,
    },
}

impl TakeResult {
    fn cancelled() -> Self {
        TakeResult::Cancelled { partial: None }
    }
}
// runner.js が返す形。期限切れと結果の不正はこの形では返せない（決めるのは Swift と Rust だけ）。
#[derive(Deserialize)]
#[serde(tag = "code", rename_all = "kebab-case", deny_unknown_fields)]
enum BundleFailure {
    Llm {
        message: String,
        #[serde(default)]
        status: Option<u16>,
    },
    Connection,
    Error {
        message: String,
    },
}

#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "lowercase", deny_unknown_fields)]
enum BundleOutcome {
    Done {
        result: Value,
    },
    Failed {
        error: BundleFailure,
        #[serde(default)]
        partial: Option<Vec<Partial>>,
    },
    Cancelled {
        #[serde(default)]
        partial: Option<Vec<Partial>>,
    },
}

fn cap_message(message: String) -> String {
    if chars_within(&message, MAX_MESSAGE_CHARS) {
        message
    } else {
        message.chars().take(MAX_MESSAGE_CHARS).collect()
    }
}
// 分類以外の partial は捨てる。グループの添字は送ったグループの数までに限る。
fn keep_partial(kind: AnalysisKind, partial: Option<Vec<Partial>>) -> Option<Vec<Partial>> {
    if kind != AnalysisKind::Classify {
        return None;
    }
    let partial = partial?;
    let in_range = partial
        .iter()
        .all(|p| usize::from(p.group) < MAX_CLASSIFY_GROUPS);
    in_range.then_some(partial)
}
// 取消しが届いたときには runner.js が全グループを終えていた。従来の経路と同じく、終わっていたグループとして全部を返す。
fn partial_of_done(mut result: Map<String, Value>) -> Option<Vec<Partial>> {
    let Some(Value::Array(groups)) = result.remove("suggestions") else {
        return None;
    };
    groups
        .into_iter()
        .enumerate()
        .map(|(index, suggestions)| match suggestions {
            Value::Array(suggestions) => Some(Partial {
                group: u8::try_from(index).ok()?,
                suggestions,
            }),
            _ => None,
        })
        .collect()
}
/// runner.js の出力を TakeResult へ読み替える。読めない・大きすぎる・オブジェクトでない結果は invalid-result。
pub(crate) fn interpret(kind: AnalysisKind, bytes: &[u8]) -> TakeResult {
    let invalid = TakeResult::Failed {
        error: RunnerFailure::InvalidResult,
        partial: None,
    };
    if bytes.len() > MAX_RESULT_BYTES {
        return invalid;
    }
    let Ok(outcome) = serde_json::from_slice::<BundleOutcome>(bytes) else {
        return invalid;
    };
    match outcome {
        BundleOutcome::Done {
            result: Value::Object(result),
        } => TakeResult::Done { result },
        BundleOutcome::Done { .. } => invalid,
        BundleOutcome::Failed { error, partial } => TakeResult::Failed {
            error: match error {
                BundleFailure::Llm { message, status } => RunnerFailure::Llm {
                    message: cap_message(message),
                    status,
                },
                BundleFailure::Connection => RunnerFailure::Connection,
                BundleFailure::Error { message } => RunnerFailure::Error {
                    message: cap_message(message),
                },
            },
            partial: keep_partial(kind, partial),
        },
        BundleOutcome::Cancelled { partial } => TakeResult::Cancelled {
            partial: keep_partial(kind, partial),
        },
    }
}
/// 背景処理の表示。タイトルもサブタイトルも固定で、ジョブの中身を含まない。
pub(crate) struct BackgroundText {
    pub(crate) title: &'static std::ffi::CStr,
    pub(crate) subtitle: &'static std::ffi::CStr,
}
/// Swift へ渡す開始の引数。script と spec は渡し終えたら捨てる。
/// engine は端末内のエンジンで読む領収書のときだけ 1 tesseract / 2 native / 3 apple-ai、それ以外は 0。
/// image はそのときだけ、検査済みの base64 を Rust が復号したもの（Swift は仕様を読まない）。
pub(crate) struct NativeStart {
    pub(crate) script: Vec<u8>,
    pub(crate) spec: Vec<u8>,
    pub(crate) text: BackgroundText,
    pub(crate) engine: u32,
    pub(crate) image: Option<Vec<u8>>,
}
// 端末内のエンジンで読む領収書だけ、画像を復号して番号と一緒に Swift へ渡す。復号できなければ開始しない。
fn local_receipt_image(spec: &Spec) -> Result<(u32, Option<Vec<u8>>), StartError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let code = match spec.engine {
        Engine::Tesseract => 1,
        Engine::Native => 2,
        Engine::AppleAi => 3,
        Engine::Gemini | Engine::OpenaiCompatible => return Ok((0, None)),
    };
    let Input::Receipt(receipt) = &spec.input else {
        return Ok((0, None));
    };
    let image = STANDARD
        .decode(receipt.image.base64.as_bytes())
        .map_err(|_| StartError::StartFailed)?;
    Ok((code, Some(image)))
}
// OS の AI の失敗のコード（AppleIntelligence.swift の意味に揃える）。走っているジョブが無い・結果を渡せないのは「その他」。
pub(crate) const AI_UNREADABLE: u8 = 2;
pub(crate) const AI_OTHER: u8 = 3;
// aoiko_ai_run の task。1 分類 / 2 注文取込。
const AI_TASK_CLASSIFY: i32 = 1;
const AI_TASK_ORDER: i32 = 2;
/// Swift の開始の答え。
pub(crate) const NATIVE_STARTED: i32 = 0;
pub(crate) const NATIVE_USE_WEBVIEW: i32 = 2;
/// OS 側（Swift）への出口。テストでは偽物に差し替える。
pub(crate) trait RunnerNative: Send + Sync {
    /// 0 開始 / 1 断った / 2 web view の経路へ戻す。
    fn start(&self, token: u64, start: NativeStart) -> i32;
    fn cancel(&self, token: u64);
    fn reply(&self, token: u64, request: u64, body: Option<Vec<u8>>);
    fn app_active(&self) -> bool;
    fn notify_status(&self) -> NotifyStatus;
    fn post(&self, kind: AnalysisKind, text: notify::Text) -> bool;
    /// OS の AI。戻るまで待つ（呼ぶのは Swift の専用キューから来たスレッド）。
    fn ai_extract(&self, image: &[u8]) -> Result<String, u8>;
    fn ai_run(&self, task: i32, data: &str) -> Result<String, u8>;
}

pub(crate) type FetchFuture = Pin<Box<dyn Future<Output = Option<Vec<u8>>> + Send>>;
/// 通信と URL の可否はアプリ側（reqwest と is_allowed_url を持つ側）が担う。
pub(crate) trait RunnerNet: Send + Sync {
    fn url_allowed(&self, raw: &str) -> bool;
    fn fetch(&self, frame: Vec<u8>, origin: String) -> Option<FetchFuture>;
}
/// 実行に使う runner.js と、端末内のエンジンが使うアセット。名前は固定で、JS から指定させない。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunnerAsset {
    Runner,
    TesseractCore,
    TesseractCoreFallback,
    JpnTraineddata,
    // jpn.traineddata の長さを記したマニフェスト。Swift へは渡さない。
    AssetManifest,
}

impl RunnerAsset {
    pub(crate) fn path(self) -> &'static str {
        match self {
            RunnerAsset::Runner => "native-runner/runner.js",
            RunnerAsset::TesseractCore => "tesseract/tesseract-core.wasm",
            RunnerAsset::TesseractCoreFallback => "tesseract/tesseract-core-fallback.wasm",
            RunnerAsset::JpnTraineddata => "tesseract/jpn.traineddata",
            RunnerAsset::AssetManifest => "native-runner/assets.json",
        }
    }
    /// Swift が番号で求められるのはこの 3 つだけ。runner.js とマニフェストは番号を持たない。
    pub(crate) fn from_swift_code(code: u32) -> Option<Self> {
        match code {
            1 => Some(RunnerAsset::TesseractCore),
            2 => Some(RunnerAsset::TesseractCoreFallback),
            3 => Some(RunnerAsset::JpnTraineddata),
            _ => None,
        }
    }
}
// Wasm の先頭（magic と version 1）。
const WASM_HEADER: &[u8] = b"\0asm\x01\0\0\0";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetManifest {
    #[serde(rename = "jpnTraineddata")]
    jpn_traineddata: usize,
}
// アセットが無い名前には index.html が返るので、中身の形で本物かを確かめる。空も無いものとして扱う。
pub(crate) fn checked_asset(loader: &ScriptLoader, asset: RunnerAsset) -> Option<Vec<u8>> {
    let bytes = loader(asset).filter(|bytes| !bytes.is_empty())?;
    let genuine = match asset {
        RunnerAsset::TesseractCore | RunnerAsset::TesseractCoreFallback => {
            bytes.starts_with(WASM_HEADER)
        }
        RunnerAsset::JpnTraineddata => {
            let manifest = loader(RunnerAsset::AssetManifest)?;
            let manifest: AssetManifest = serde_json::from_slice(&manifest).ok()?;
            manifest.jpn_traineddata == bytes.len()
        }
        RunnerAsset::Runner | RunnerAsset::AssetManifest => false,
    };
    genuine.then_some(bytes)
}
/// runner.js の先頭に必ずある目印。アセットが無いと index.html が返るので、中身で見分ける。
pub(crate) const RUNNER_MARKER: &[u8] = b"/* aoiko-native-runner */";

pub(crate) type ScriptLoader = Box<dyn Fn(RunnerAsset) -> Option<Vec<u8>> + Send + Sync>;
/// web 側へ解析の入口（runAnalysis 等）を出させる印。
pub(crate) const RUNNER_FLAG_SCRIPT: &str = "window.__aoikoRunnerBuild = true;";
// 印を出すのは、開発時でなく、固定の名前の runner.js が本物のときだけ。無ければ従来の web view の経路のままにする。
// 開始のたびの目印の検査（start）はこれとは別に残す。
pub(crate) fn runner_flag_script(is_dev: bool, asset: Option<&[u8]>) -> &'static str {
    match asset {
        Some(bytes) if !is_dev && bytes.starts_with(RUNNER_MARKER) => RUNNER_FLAG_SCRIPT,
        _ => "",
    }
}

struct Active {
    job: JobId,
    token: u64,
    kind: AnalysisKind,
    engine: Engine,
    locale: UiLocale,
    notify: bool,
    origin: Option<String>,
    page_generation: u64,
    // 結果が先に決まった（ページの入れ替え・期限切れ）。Swift の終了報告を待つ間も busy。
    decided: bool,
    user_cancelled: bool,
    in_flight: HashMap<u64, tauri::async_runtime::JoinHandle<()>>,
}

impl Active {
    fn abort_in_flight(&mut self) {
        for (_, handle) in self.in_flight.drain() {
            handle.abort();
        }
    }
}

#[derive(Default)]
struct State {
    page_generation: u64,
    next_token: u64,
    active: Option<Active>,
    finished: Option<(JobId, TakeResult)>,
    tombstones: VecDeque<JobId>,
    // 戻っていない OS の AI の呼び出し。ジョブが閉じても、戻るまでは次を始めさせない。
    ai_calls: usize,
}

impl State {
    fn remember(&mut self, job: JobId) {
        if self.tombstones.iter().any(|seen| seen == &job) {
            return;
        }
        if self.tombstones.len() >= TOMBSTONE_MEMORY {
            self.tombstones.pop_front();
        }
        self.tombstones.push_back(job);
    }
}
/// 一度に 1 件だけ走らせる台帳。Swift が JSContext を手放したと報告するまで次を始めさせない。
pub(crate) struct Runner<N> {
    native: N,
    net: Box<dyn RunnerNet>,
    script: ScriptLoader,
    state: Mutex<State>,
    changed: Condvar,
}

struct Notice {
    kind: AnalysisKind,
    locale: UiLocale,
    outcome: Outcome,
}

impl<N: RunnerNative + 'static> Runner<N> {
    pub(crate) fn new(native: N, net: Box<dyn RunnerNet>, script: ScriptLoader) -> Self {
        Self {
            native,
            net,
            script,
            state: Mutex::new(State::default()),
            changed: Condvar::new(),
        }
    }

    fn locked(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn start(&self, raw: Value) -> Result<(), StartError> {
        let validated = validate(raw, &|url| self.net.url_allowed(url))?;
        let script = (self.script)(RunnerAsset::Runner)
            .filter(|bytes| bytes.starts_with(RUNNER_MARKER))
            .ok_or(StartError::StartFailed)?;
        let spec = serde_json::to_vec(&validated.spec).map_err(|_| StartError::StartFailed)?;
        let kind = validated.spec.kind;
        let engine = validated.spec.engine;
        let locale = validated.spec.locale;
        let notify = validated.spec.notify;
        let (engine_code, image) = local_receipt_image(&validated.spec)?;
        // 仕様（API キーを含む）はここで手放す。以降持つのは宛先の origin だけ。
        drop(validated.spec);
        let token = {
            let mut state = self.locked();
            if state.tombstones.iter().any(|seen| seen == &validated.job) {
                // 開始より先に取消しが届いた。登録せず、take は cancelled を返す。
                return Ok(());
            }
            if state.active.is_some() || state.ai_calls > 0 {
                return Err(StartError::StartFailed);
            }
            state.next_token = state.next_token.wrapping_add(1);
            let token = state.next_token;
            let page_generation = state.page_generation;
            state.active = Some(Active {
                job: validated.job.clone(),
                token,
                kind,
                engine,
                locale,
                notify,
                origin: validated.origin,
                page_generation,
                decided: false,
                user_cancelled: false,
                in_flight: HashMap::new(),
            });
            token
        };
        let answer = self.native.start(
            token,
            NativeStart {
                script,
                spec,
                text: notify::background_text(locale, kind),
                engine: engine_code,
                image,
            },
        );
        if answer == NATIVE_STARTED {
            return Ok(());
        }
        {
            let mut state = self.locked();
            if state.active.as_ref().is_some_and(|a| a.token == token) {
                state.active = None;
            }
            // 開始の間にページの読み込みが重なると、このジョブの結果が先に置かれている。
            if state
                .finished
                .as_ref()
                .is_some_and(|(done, _)| done == &validated.job)
            {
                state.finished = None;
            }
        }
        self.changed.notify_all();
        // web view へ戻すのは、端末内のエンジンで読む領収書を Swift が断ったときだけ。
        if answer == NATIVE_USE_WEBVIEW && engine_code != 0 {
            Err(StartError::UseWebview)
        } else {
            Err(StartError::StartFailed)
        }
    }
    /// OS の AI の呼び出し（Swift の専用キューから）。何を頼むかはジョブの種類から決め、
    /// 戻るまで busy を保つ。走っている apple-ai のジョブが無ければ固定のコード。
    pub(crate) fn ai(&self, token: u64, payload: &[u8]) -> Result<String, u8> {
        let kind = {
            let mut state = self.locked();
            let kind = match state.active.as_ref() {
                Some(active)
                    if active.token == token
                        && active.engine == Engine::AppleAi
                        && !active.decided
                        && !active.user_cancelled =>
                {
                    active.kind
                }
                _ => return Err(AI_OTHER),
            };
            state.ai_calls = state.ai_calls.saturating_add(1);
            kind
        };
        let result = match kind {
            AnalysisKind::Receipt => self.native.ai_extract(payload),
            AnalysisKind::Order => match std::str::from_utf8(payload) {
                Ok(text) => self.native.ai_run(AI_TASK_ORDER, text),
                Err(_) => Err(AI_UNREADABLE),
            },
            AnalysisKind::Classify => match std::str::from_utf8(payload) {
                Ok(text) => self.native.ai_run(AI_TASK_CLASSIFY, text),
                Err(_) => Err(AI_UNREADABLE),
            },
        };
        {
            let mut state = self.locked();
            state.ai_calls = state.ai_calls.saturating_sub(1);
        }
        self.changed.notify_all();
        result
    }
    /// 走っている apple-ai のジョブの種類。大きさの上限を選ぶために先に問う。
    pub(crate) fn ai_kind(&self, token: u64) -> Option<AnalysisKind> {
        let state = self.locked();
        state
            .active
            .as_ref()
            .filter(|active| active.token == token && active.engine == Engine::AppleAi)
            .map(|active| active.kind)
    }
    /// aoiko_runner_ai の中身。成功は CString::into_raw（ai_release でだけ解放）、失敗は null と固定のコード。
    pub(crate) fn ai_raw(
        &self,
        token: u64,
        ptr: *const u8,
        len: usize,
        out_code: *mut i32,
    ) -> *mut c_char {
        if out_code.is_null() {
            return std::ptr::null_mut();
        }
        let answer = self
            .ai_payload(token, ptr, len)
            .and_then(|payload| self.ai(token, &payload));
        let json = match answer {
            Ok(json) => json,
            Err(code) => return ai_refused(out_code, code),
        };
        let Ok(json) = CString::new(json) else {
            return ai_refused(out_code, AI_OTHER);
        };
        unsafe { *out_code = 0 };
        json.into_raw()
    }
    // 大きさを確かめてから領域を読み、すぐに写す。ポインタは持ち続けない。
    fn ai_payload(&self, token: u64, ptr: *const u8, len: usize) -> Result<Vec<u8>, u8> {
        let kind = self.ai_kind(token).ok_or(AI_OTHER)?;
        let ceiling = match kind {
            AnalysisKind::Receipt => APPLE_AI_IMAGE_CEILING_BYTES,
            AnalysisKind::Order | AnalysisKind::Classify => APPLE_AI_DATA_CEILING_BYTES,
        };
        check_apple_ai_payload_len(len, ceiling)?;
        if ptr.is_null() {
            return Err(AI_UNREADABLE);
        }
        Ok(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
    }
    /// Swift が番号で求めたアセット。毎回読み直し、手元には残さない。
    pub(crate) fn asset(&self, code: u32) -> Option<Vec<u8>> {
        checked_asset(&self.script, RunnerAsset::from_swift_code(code)?)
    }
    /// ジョブが終わるまで待って結果を 1 度だけ返す。知らないジョブは cancelled。
    pub(crate) fn take(&self, job: &JobId) -> TakeResult {
        let mut state = self.locked();
        loop {
            if state.finished.as_ref().is_some_and(|(done, _)| done == job) {
                if let Some((_, result)) = state.finished.take() {
                    return result;
                }
            }
            let waiting = state.active.as_ref().is_some_and(|a| &a.job == job);
            if !waiting {
                return TakeResult::cancelled();
            }
            state = match self.changed.wait_timeout(state, TAKE_RECHECK) {
                Ok((guard, _)) => guard,
                Err(poisoned) => poisoned.into_inner().0,
            };
        }
    }
    /// 利用者の取消し。走っているジョブなら止め、まだ始まっていなければ取消し済みの印を残す。
    pub(crate) fn cancel(&self, job: &JobId) {
        let token = {
            let mut state = self.locked();
            match state.active.as_mut() {
                Some(active) if &active.job == job => {
                    if active.decided || active.user_cancelled {
                        return;
                    }
                    active.user_cancelled = true;
                    active.abort_in_flight();
                    active.token
                }
                _ => {
                    let known = state.finished.as_ref().is_some_and(|(done, _)| done == job);
                    if !known {
                        state.remember(job.clone());
                    }
                    return;
                }
            }
        };
        self.native.cancel(token);
    }
    /// ページの読み込み。始まりで世代を進め、前の世代のジョブだけを取り消す。
    pub(crate) fn page_load(&self, started: bool) {
        let token = {
            let mut state = self.locked();
            if started {
                state.page_generation = state.page_generation.wrapping_add(1);
            }
            let generation = state.page_generation;
            let Some(active) = state.active.as_mut() else {
                return;
            };
            if active.decided || active.page_generation == generation {
                return;
            }
            active.decided = true;
            active.abort_in_flight();
            let token = active.token;
            let job = active.job.clone();
            state.finished = Some((job, TakeResult::cancelled()));
            token
        };
        self.changed.notify_all();
        self.native.cancel(token);
    }
    /// 背景で動ける時間が尽きた。結果は失敗に決め、通信を切ってから通知する。
    pub(crate) fn expired(&self, token: u64) {
        let notice = {
            let mut state = self.locked();
            let Some(active) = state.active.as_mut() else {
                return;
            };
            if active.token != token || active.decided || active.user_cancelled {
                return;
            }
            active.decided = true;
            active.abort_in_flight();
            let job = active.job.clone();
            let notice = active.notify.then_some(Notice {
                kind: active.kind,
                locale: active.locale,
                outcome: Outcome::Failed,
            });
            state.finished = Some((
                job,
                TakeResult::Failed {
                    error: RunnerFailure::Expired,
                    partial: None,
                },
            ));
            notice
        };
        self.changed.notify_all();
        self.native.cancel(token);
        if let Some(notice) = notice {
            self.notify(notice);
        }
    }
    /// Swift が JSContext を手放したあとの報告。ここで busy が解ける。戻り値はこのジョブが done に
    /// 決まったかどうかで、Swift は背景処理をこの成否で閉じる。
    pub(crate) fn complete(&self, token: u64, bytes: &[u8]) -> bool {
        let (notice, done) = {
            let mut state = self.locked();
            let Some(mut active) = state.active.take() else {
                return false;
            };
            if active.token != token {
                state.active = Some(active);
                return false;
            }
            active.abort_in_flight();
            if active.decided {
                (None, false)
            } else {
                let result = if active.user_cancelled {
                    match interpret(active.kind, bytes) {
                        TakeResult::Cancelled { partial } | TakeResult::Failed { partial, .. } => {
                            TakeResult::Cancelled { partial }
                        }
                        TakeResult::Done { result } => TakeResult::Cancelled {
                            partial: keep_partial(active.kind, partial_of_done(result)),
                        },
                    }
                } else {
                    interpret(active.kind, bytes)
                };
                let outcome = match &result {
                    TakeResult::Done { .. } => Some(Outcome::Done),
                    TakeResult::Failed { .. } => Some(Outcome::Failed),
                    TakeResult::Cancelled { .. } => None,
                };
                state.finished = Some((active.job.clone(), result));
                let done = outcome == Some(Outcome::Done);
                let notice = outcome.filter(|_| active.notify).map(|outcome| Notice {
                    kind: active.kind,
                    locale: active.locale,
                    outcome,
                });
                (notice, done)
            }
        };
        self.changed.notify_all();
        if let Some(notice) = notice {
            self.notify(notice);
        }
        done
    }
    // 利用者がアプリを見ているときは出さない。許可は出す直前に OS へ問い直す。
    fn notify(&self, notice: Notice) {
        if self.native.app_active() || self.native.notify_status() != NotifyStatus::Granted {
            return;
        }
        let text = notify::text(notice.locale, notice.kind, notice.outcome);
        let _ = self.native.post(notice.kind, text);
    }
    /// runner.js からの通信の要求。このジョブの宛先へ向かうものだけをアプリ側へ渡す。
    pub(crate) fn fetch(self: &'static Self, token: u64, request: u64, frame: Vec<u8>) {
        let origin = {
            let state = self.locked();
            match state.active.as_ref() {
                Some(active)
                    if active.token == token && !active.decided && !active.user_cancelled =>
                {
                    active.origin.clone()
                }
                _ => return,
            }
        };
        // 端末内のエンジンのジョブは宛先を持たない。通信へは出さずに失敗で返す。
        let Some(future) = origin.and_then(|origin| self.net.fetch(frame, origin)) else {
            self.native.reply(token, request, None);
            return;
        };
        let handle = tauri::async_runtime::spawn(async move {
            let reply = future.await;
            self.fetched(token, request, reply);
        });
        let mut state = self.locked();
        match state.active.as_mut() {
            Some(active) if active.token == token && !active.decided && !active.user_cancelled => {
                active.in_flight.insert(request, handle);
            }
            _ => handle.abort(),
        }
    }
    // 遅れて戻った応答は、そのジョブがまだ同じ世代で走っているときだけ渡す。
    fn fetched(&self, token: u64, request: u64, reply: Option<Vec<u8>>) {
        {
            let mut state = self.locked();
            match state.active.as_mut() {
                Some(active)
                    if active.token == token && !active.decided && !active.user_cancelled =>
                {
                    active.in_flight.remove(&request);
                }
                _ => return,
            }
        }
        self.native.reply(token, request, reply);
    }
}

// 失敗のコードを書いて null を返す。out_code は呼び元が null でないことを確かめてある。
pub(crate) fn ai_refused(out_code: *mut i32, code: u8) -> *mut c_char {
    if !out_code.is_null() {
        unsafe { *out_code = i32::from(code) };
    }
    std::ptr::null_mut()
}
/// ai_raw が返した文字列の解放。null は何もしない。
///
/// # Safety
/// ptr は ai_raw が返したもので、まだ解放していないこと。
pub(crate) unsafe fn ai_release(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    drop(unsafe { CString::from_raw(ptr) });
}
/// Swift へ渡すアセットの領域。Rust が確保し、asset_release でだけ解放する。
/// out_len が null なら何も読まずに null。そうでなければ最初に 0 を書く。
pub(crate) fn asset_raw(
    asset: impl FnOnce(u32) -> Option<Vec<u8>>,
    code: u32,
    out_len: *mut usize,
) -> *mut u8 {
    if out_len.is_null() {
        return std::ptr::null_mut();
    }
    unsafe { *out_len = 0 };
    let Some(bytes) = asset(code) else {
        return std::ptr::null_mut();
    };
    let boxed = bytes.into_boxed_slice();
    let len = boxed.len();
    if len == 0 {
        return std::ptr::null_mut();
    }
    unsafe { *out_len = len };
    Box::into_raw(boxed).cast::<u8>()
}
/// asset_raw が確保した領域を、同じ長さで作り直して解放する。null は何もしない。
///
/// # Safety
/// ptr と len は asset_raw が返した組で、まだ解放していないこと。
pub(crate) unsafe fn asset_release(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)) });
}

type FetchCallback = Box<dyn Fn(Vec<u8>, String) -> FetchFuture + Send + Sync>;

static FETCHER: OnceLock<FetchCallback> = OnceLock::new();
static URL_CHECK: OnceLock<fn(&str) -> bool> = OnceLock::new();
/// アプリ側の HTTP クライアントを渡す。frame は aoiko_fetch と同じ形、origin はジョブの宛先。
/// 応答は aoiko_fetch と同じ形の frame、失敗は None。
pub fn set_runner_fetcher<F, Fut>(fetch: F)
where
    F: Fn(Vec<u8>, String) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = Option<Vec<u8>>> + Send + 'static,
{
    let _ = FETCHER.set(Box::new(move |frame, origin| {
        Box::pin(fetch(frame, origin))
    }));
}
/// 宛先の可否を決める関数（アプリ側の is_allowed_url）を渡す。
pub fn set_runner_url_check(check: fn(&str) -> bool) {
    let _ = URL_CHECK.set(check);
}
// 登録が無ければ何も許さない。
struct GlobalNet;

impl RunnerNet for GlobalNet {
    fn url_allowed(&self, raw: &str) -> bool {
        URL_CHECK.get().is_some_and(|check| check(raw))
    }

    fn fetch(&self, frame: Vec<u8>, origin: String) -> Option<FetchFuture> {
        FETCHER.get().map(|fetch| fetch(frame, origin))
    }
}

pub(crate) fn global_net() -> Box<dyn RunnerNet> {
    Box::new(GlobalNet)
}

#[cfg(target_os = "ios")]
pub(crate) mod ios {
    use std::ffi::c_char;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::OnceLock;

    use tauri::{AppHandle, Runtime};

    use super::{global_net, NativeStart, Runner, RunnerAsset, RunnerNative};
    use crate::notify::{self, AnalysisKind, NotifyStatus};

    extern "C" {
        fn aoiko_runner_install(
            fetch: extern "C" fn(u64, u64, *const u8, usize),
            complete: extern "C" fn(u64, *const u8, usize) -> i32,
            expired: extern "C" fn(u64),
            asset: extern "C" fn(u32, *mut usize) -> *mut u8,
            asset_free: extern "C" fn(*mut u8, usize),
            ai: extern "C" fn(u64, *const u8, usize, *mut i32) -> *mut c_char,
            ai_free: extern "C" fn(*mut c_char),
        );
        fn aoiko_runner_start(
            token: u64,
            script: *const u8,
            script_len: usize,
            spec: *const u8,
            spec_len: usize,
            title: *const c_char,
            subtitle: *const c_char,
            engine: u32,
            image: *const u8,
            image_len: usize,
        ) -> i32;
        fn aoiko_runner_cancel(token: u64);
        fn aoiko_runner_reply(token: u64, request: u64, ok: i32, body: *const u8, len: usize);
        fn aoiko_app_is_active() -> i32;
    }

    pub(crate) struct SwiftNative;

    impl RunnerNative for SwiftNative {
        // Swift は戻る前に中身をすべて写し終える。
        fn start(&self, token: u64, start: NativeStart) -> i32 {
            let (image, image_len) = match start.image.as_ref() {
                Some(image) => (image.as_ptr(), image.len()),
                None => (std::ptr::null(), 0),
            };
            unsafe {
                aoiko_runner_start(
                    token,
                    start.script.as_ptr(),
                    start.script.len(),
                    start.spec.as_ptr(),
                    start.spec.len(),
                    start.text.title.as_ptr(),
                    start.text.subtitle.as_ptr(),
                    start.engine,
                    image,
                    image_len,
                )
            }
        }

        fn cancel(&self, token: u64) {
            unsafe { aoiko_runner_cancel(token) }
        }

        fn reply(&self, token: u64, request: u64, body: Option<Vec<u8>>) {
            match body {
                Some(body) => unsafe {
                    aoiko_runner_reply(token, request, 1, body.as_ptr(), body.len())
                },
                None => unsafe { aoiko_runner_reply(token, request, 0, std::ptr::null(), 0) },
            }
        }
        // ネイティブ側は応答を待つ。メインスレッドから呼ばない。
        fn app_active(&self) -> bool {
            unsafe { aoiko_app_is_active() == 1 }
        }

        fn notify_status(&self) -> NotifyStatus {
            crate::ios::analysis_notify::status()
        }

        fn post(&self, kind: AnalysisKind, text: notify::Text) -> bool {
            crate::ios::analysis_notify::post(kind, text.title, text.body)
        }

        fn ai_extract(&self, image: &[u8]) -> Result<String, u8> {
            crate::ios::apple_intelligence::extract(image)
        }

        fn ai_run(&self, task: i32, data: &str) -> Result<String, u8> {
            crate::ios::apple_intelligence::run(task, data)
        }
    }

    static RUNNER: OnceLock<Runner<SwiftNative>> = OnceLock::new();

    pub(crate) fn global() -> Option<&'static Runner<SwiftNative>> {
        RUNNER.get()
    }
    // web view を作る前に、埋め込まれたアセットを読んで決める。
    pub(crate) fn flag_script<R: Runtime>(app: &AppHandle<R>) -> &'static str {
        let asset = app
            .asset_resolver()
            .get(RunnerAsset::Runner.path().to_string());
        super::runner_flag_script(tauri::is_dev(), asset.as_ref().map(|a| a.bytes.as_slice()))
    }
    // アセットが見つからない（開発時の devUrl 等）ときは、開始のたびに start-failed で断る。
    pub(crate) fn install<R: Runtime>(app: &AppHandle<R>) {
        let resolver = app.clone();
        let loader = Box::new(move |asset: RunnerAsset| {
            resolver
                .asset_resolver()
                .get(asset.path().to_string())
                .map(|asset| asset.bytes)
        });
        let _ = RUNNER.set(Runner::new(SwiftNative, global_net(), loader));
        unsafe {
            aoiko_runner_install(
                on_fetch,
                on_complete,
                on_expired,
                on_asset,
                on_asset_free,
                aoiko_runner_ai,
                aoiko_runner_ai_free,
            )
        };
    }
    // ここから下は Swift から呼ばれる入口。リリースは panic = "abort" なので、panic し得る書き方を
    // しない（ソースの固定テストで見ている）。catch_unwind はデバッグとテストのために残す。
    fn copy_bytes(ptr: *const u8, len: usize) -> Vec<u8> {
        if ptr.is_null() {
            return Vec::new();
        }
        unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
    }

    extern "C" fn on_fetch(token: u64, request: u64, ptr: *const u8, len: usize) {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            let frame = copy_bytes(ptr, len);
            if let Some(runner) = global() {
                runner.fetch(token, request, frame);
            }
        }));
    }
    // 1 はこのジョブが done に決まったとき。それ以外（失敗・取消し・期限切れ・不正・panic）は 0。
    extern "C" fn on_complete(token: u64, ptr: *const u8, len: usize) -> i32 {
        let done = catch_unwind(AssertUnwindSafe(|| {
            let bytes = copy_bytes(ptr, len);
            global().is_some_and(|runner| runner.complete(token, &bytes))
        }));
        i32::from(matches!(done, Ok(true)))
    }

    extern "C" fn on_expired(token: u64) {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            if let Some(runner) = global() {
                runner.expired(token);
            }
        }));
    }
    // 番号 1〜3 のアセットだけ。領域は on_asset_free でだけ解放する。
    extern "C" fn on_asset(code: u32, out_len: *mut usize) -> *mut u8 {
        let ptr = catch_unwind(AssertUnwindSafe(|| {
            super::asset_raw(
                |code| global().and_then(|runner| runner.asset(code)),
                code,
                out_len,
            )
        }));
        ptr.unwrap_or(std::ptr::null_mut())
    }

    extern "C" fn on_asset_free(ptr: *mut u8, len: usize) {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
            super::asset_release(ptr, len)
        }));
    }
    // OS の AI。呼ぶのは Swift の専用キュー。結果は aoiko_runner_ai_free でだけ解放する。
    extern "C" fn aoiko_runner_ai(
        token: u64,
        ptr: *const u8,
        len: usize,
        out_code: *mut i32,
    ) -> *mut c_char {
        let json = catch_unwind(AssertUnwindSafe(|| match global() {
            Some(runner) => runner.ai_raw(token, ptr, len, out_code),
            None => super::ai_refused(out_code, super::AI_OTHER),
        }));
        json.unwrap_or(std::ptr::null_mut())
    }

    extern "C" fn aoiko_runner_ai_free(ptr: *mut c_char) {
        let _ = catch_unwind(AssertUnwindSafe(|| unsafe { super::ai_release(ptr) }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::Arc;

    fn allow_all(_: &str) -> bool {
        true
    }
    // アプリ側の is_allowed_url と同じ集合を、テストのために写したもの。
    fn app_like(raw: &str) -> bool {
        let Ok(url) = Url::parse(raw) else {
            return false;
        };
        match url.scheme() {
            "https" => true,
            "http" => matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "[::1]")
            ),
            _ => false,
        }
    }

    fn openai_spec() -> Value {
        serde_json::json!({
            "job": "page-1-job",
            "kind": "order",
            "engine": "openai-compatible",
            "locale": "ja",
            "notify": true,
            "adapter": { "model": "qwen2.5-vl-7b-instruct@q4_k_m", "apiKey": "sk-SECRET", "baseUrl": "http://127.0.0.1:41741/v1" },
            "input": { "text": "注文 1,200 円" }
        })
    }

    fn gemini_spec() -> Value {
        serde_json::json!({
            "job": "g-1",
            "kind": "receipt",
            "engine": "gemini",
            "locale": "en",
            "notify": false,
            "adapter": { "model": "gemini-2.5-flash", "apiKey": "AIza-SECRET" },
            "input": { "image": { "base64": "AAAA", "mimeType": "image/jpeg" } }
        })
    }

    fn classify_spec(groups: Value) -> Value {
        serde_json::json!({
            "job": "c-1",
            "kind": "classify",
            "engine": "openai-compatible",
            "locale": "zh-TW",
            "notify": true,
            "adapter": { "model": "m", "apiKey": "", "baseUrl": "https://api.example.com/v1" },
            "input": { "groups": groups }
        })
    }

    fn group(side: &str) -> Value {
        serde_json::json!({
            "knownSide": side,
            "inputs": [{ "ref": "0", "description": "コンビニ", "amount": "1200" }],
            "options": {
                "knownAccountCode": "1130",
                "knownSide": side,
                "candidateAccounts": [{ "code": "5200", "name": "消耗品費", "category": "expense" }]
            }
        })
    }

    fn set(spec: &mut Value, path: &[&str], value: Value) {
        let mut cursor = spec;
        for key in &path[..path.len() - 1] {
            cursor = cursor.get_mut(*key).unwrap();
        }
        cursor[path[path.len() - 1]] = value;
    }

    fn check(spec: Value) -> Result<Validated, StartError> {
        validate(spec, &allow_all)
    }

    #[test]
    fn caps_equal_the_values_stated_in_the_plan() {
        assert_eq!(MAX_IMAGE_BASE64_LEN, 20_971_524);
        assert_eq!(
            MAX_IMAGE_BASE64_LEN,
            (15 * 1024 * 1024 * 4usize).div_ceil(3) + 4
        );
        assert_eq!(MAX_ORDER_TEXT_BYTES, 50 * 1024 * 1024);
        assert_eq!(MAX_CLASSIFY_GROUPS, 2);
        assert_eq!(MAX_CLASSIFY_GROUPS_BYTES, 100 * 1024 * 1024);
        assert_eq!(MAX_MODEL_CHARS, 256);
        assert_eq!(MAX_API_KEY_CHARS, 4096);
        assert_eq!(MAX_BASE_URL_CHARS, 2048);
        assert_eq!(MAX_SPEC_BYTES, 200 * 1024 * 1024);
        assert_eq!(MAX_RESULT_BYTES, 64 * 1024 * 1024);
        assert_eq!(MAX_RESPONSE_BODY_BYTES, 64 * 1024 * 1024);
        assert_eq!(MAX_MESSAGE_CHARS, 2000);
    }
    // file-limit.ts の値と食い違わないこと。
    #[test]
    fn caps_derive_from_the_web_side_file_limits() {
        let source = include_str!("../../../../src/lib/file-limit.ts");
        assert!(source.contains("export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;"));
        assert!(source.contains("export const MAX_CSV_BYTES = 50 * 1024 * 1024;"));
    }

    #[test]
    fn openai_model_with_at_sign_is_accepted_and_gemini_is_refused() {
        assert!(check(openai_spec()).is_ok());
        let mut gemini = gemini_spec();
        set(&mut gemini, &["adapter", "model"], "gemini@x".into());
        assert_eq!(check(gemini).err(), Some(StartError::StartFailed));
        let mut gemini = gemini_spec();
        set(
            &mut gemini,
            &["adapter", "model"],
            "models/gemini-2.5:flash_x.y".into(),
        );
        assert!(check(gemini).is_ok());
    }

    #[test]
    fn inputs_exactly_at_each_cap_are_accepted_and_one_more_is_refused() {
        let mut receipt = gemini_spec();
        set(
            &mut receipt,
            &["input", "image", "base64"],
            "A".repeat(MAX_IMAGE_BASE64_LEN).into(),
        );
        assert!(check(receipt.clone()).is_ok());
        set(
            &mut receipt,
            &["input", "image", "base64"],
            "A".repeat(MAX_IMAGE_BASE64_LEN + 1).into(),
        );
        assert_eq!(check(receipt).err(), Some(StartError::StartFailed));

        let mut order = openai_spec();
        set(
            &mut order,
            &["input", "text"],
            "a".repeat(MAX_ORDER_TEXT_BYTES).into(),
        );
        assert!(check(order.clone()).is_ok());
        set(
            &mut order,
            &["input", "text"],
            "a".repeat(MAX_ORDER_TEXT_BYTES + 1).into(),
        );
        assert_eq!(check(order).err(), Some(StartError::StartFailed));

        for (path, max) in [
            (&["adapter", "model"][..], MAX_MODEL_CHARS),
            (&["adapter", "apiKey"][..], MAX_API_KEY_CHARS),
        ] {
            let mut spec = openai_spec();
            set(&mut spec, path, "字".repeat(max).into());
            assert!(check(spec.clone()).is_ok(), "{path:?}");
            set(&mut spec, path, "字".repeat(max + 1).into());
            assert_eq!(check(spec).err(), Some(StartError::StartFailed), "{path:?}");
        }
        let prefix = "https://h.example/";
        let mut spec = openai_spec();
        let at_cap = format!("{prefix}{}", "a".repeat(MAX_BASE_URL_CHARS - prefix.len()));
        set(&mut spec, &["adapter", "baseUrl"], at_cap.clone().into());
        assert!(check(spec.clone()).is_ok());
        set(
            &mut spec,
            &["adapter", "baseUrl"],
            format!("{at_cap}a").into(),
        );
        assert_eq!(check(spec).err(), Some(StartError::StartFailed));
    }

    #[test]
    fn classify_accepts_two_groups_and_refuses_three_or_mismatched_sides() {
        assert!(check(classify_spec(serde_json::json!([
            group("debit"),
            group("credit")
        ])))
        .is_ok());
        assert_eq!(
            check(classify_spec(serde_json::json!([
                group("debit"),
                group("credit"),
                group("debit")
            ])))
            .err(),
            Some(StartError::StartFailed)
        );
        assert_eq!(
            check(classify_spec(serde_json::json!([]))).err(),
            Some(StartError::StartFailed)
        );
        let mut mismatched = group("debit");
        mismatched["options"]["knownSide"] = "credit".into();
        assert_eq!(
            check(classify_spec(serde_json::json!([mismatched]))).err(),
            Some(StartError::StartFailed)
        );
    }

    #[test]
    fn candidate_accounts_are_a_projected_schema_without_extra_fields() {
        let mut extra = group("debit");
        extra["options"]["candidateAccounts"][0]["displayOrder"] = 1.into();
        assert_eq!(
            check(classify_spec(serde_json::json!([extra]))).err(),
            Some(StartError::StartFailed)
        );
        let mut amount_number = group("debit");
        amount_number["inputs"][0]["amount"] = 1200.into();
        assert_eq!(
            check(classify_spec(serde_json::json!([amount_number]))).err(),
            Some(StartError::StartFailed)
        );
    }

    #[test]
    fn unknown_kind_engine_locale_and_fields_are_refused() {
        for (path, bad) in [
            (&["kind"][..], Value::from("invoice")),
            (&["engine"][..], "tesseract".into()),
            (&["engine"][..], "apple-ai".into()),
            (&["locale"][..], "fr".into()),
            (&["locale"][..], "zh-tw".into()),
            (&["notify"][..], "yes".into()),
            (&["job"][..], "a b".into()),
            (&["job"][..], "".into()),
        ] {
            let mut spec = openai_spec();
            set(&mut spec, path, bad.clone());
            assert_eq!(
                check(spec).err(),
                Some(StartError::StartFailed),
                "{path:?} {bad}"
            );
        }
        let mut extra = openai_spec();
        extra["extra"] = 1.into();
        assert_eq!(check(extra).err(), Some(StartError::StartFailed));
        let mut extra_input = openai_spec();
        extra_input["input"]["image"] = Value::Null;
        assert_eq!(check(extra_input).err(), Some(StartError::StartFailed));
        let mut wrong_shape = gemini_spec();
        wrong_shape["input"] = serde_json::json!({ "text": "x" });
        assert_eq!(check(wrong_shape).err(), Some(StartError::StartFailed));
    }

    #[test]
    fn gemini_refuses_a_base_url_and_openai_requires_one_without_userinfo() {
        let mut gemini = gemini_spec();
        set(
            &mut gemini,
            &["adapter", "baseUrl"],
            "https://evil.example/".into(),
        );
        assert_eq!(check(gemini).err(), Some(StartError::StartFailed));
        let mut openai = openai_spec();
        openai["adapter"].as_object_mut().unwrap().remove("baseUrl");
        assert_eq!(check(openai).err(), Some(StartError::StartFailed));
        for bad in [
            "https://user:pw@h.example/v1",
            "https://user@h.example/v1",
            "not a url",
        ] {
            let mut spec = openai_spec();
            set(&mut spec, &["adapter", "baseUrl"], bad.into());
            assert_eq!(check(spec).err(), Some(StartError::StartFailed), "{bad}");
        }
    }

    #[test]
    fn a_base_url_the_app_refuses_is_disallowed_url() {
        for bad in [
            "http://192.168.1.2/",
            "ftp://example.com/",
            "http://example.com/v1",
        ] {
            let mut spec = openai_spec();
            set(&mut spec, &["adapter", "baseUrl"], bad.into());
            assert_eq!(
                validate(spec, &app_like).err(),
                Some(StartError::DisallowedUrl),
                "{bad}"
            );
        }
        assert!(validate(openai_spec(), &app_like).is_ok());
        // 判定の関数が登録されていなければ何も通さない。
        assert_eq!(
            validate(openai_spec(), &|_| false).err(),
            Some(StartError::DisallowedUrl)
        );
    }

    #[test]
    fn the_origin_comes_only_from_engine_and_base_url() {
        assert_eq!(
            check(gemini_spec()).unwrap().origin.as_deref(),
            Some(GEMINI_ORIGIN)
        );
        assert_eq!(
            check(openai_spec()).unwrap().origin.as_deref(),
            Some("http://127.0.0.1:41741")
        );
        let mut default_port = openai_spec();
        set(
            &mut default_port,
            &["adapter", "baseUrl"],
            "https://h.example:443/v1".into(),
        );
        assert_eq!(
            check(default_port).unwrap().origin.as_deref(),
            Some("https://h.example")
        );
    }

    #[test]
    fn start_errors_serialise_as_exactly_their_codes() {
        assert_eq!(
            serde_json::to_string(&StartError::StartFailed).unwrap(),
            "\"start-failed\""
        );
        assert_eq!(
            serde_json::to_string(&StartError::DisallowedUrl).unwrap(),
            "\"disallowed-url\""
        );
        assert_eq!(
            serde_json::to_string(&StartError::UseWebview).unwrap(),
            "\"use-webview\""
        );
    }

    #[test]
    fn refusals_never_carry_the_input() {
        let mut spec = openai_spec();
        set(
            &mut spec,
            &["adapter", "baseUrl"],
            "http://secret-host.example/".into(),
        );
        let err = validate(spec, &app_like).err().unwrap();
        let text = format!("{err:?}{}", serde_json::to_string(&err).unwrap());
        for secret in ["secret-host", "sk-SECRET", "注文"] {
            assert!(!text.contains(secret), "{text}");
        }
        let mut spec = openai_spec();
        set(&mut spec, &["adapter", "model"], "x".repeat(300).into());
        let text = format!("{:?}", check(spec).err().unwrap());
        assert_eq!(text, "StartFailed");
    }

    #[test]
    fn the_spec_handed_to_swift_has_only_the_listed_fields() {
        let mut spec = openai_spec();
        spec["adapter"]["baseUrl"] = "http://127.0.0.1:41741/v1".into();
        let validated = check(spec.clone()).unwrap();
        let out: Value = serde_json::to_value(&validated.spec).unwrap();
        assert_eq!(out, spec);
        let gemini = check(gemini_spec()).unwrap();
        let out: Value = serde_json::to_value(&gemini.spec).unwrap();
        assert_eq!(out, gemini_spec());
        let classify = classify_spec(serde_json::json!([group("debit")]));
        let out: Value = serde_json::to_value(&check(classify.clone()).unwrap().spec).unwrap();
        assert_eq!(out, classify);
    }

    #[test]
    fn take_results_serialise_to_the_one_shape() {
        let failed = interpret(
            AnalysisKind::Order,
            serde_json::json!({ "outcome": "failed", "error": { "code": "llm", "message": "x".repeat(2100), "status": 401 } })
                .to_string()
                .as_bytes(),
        );
        let TakeResult::Failed {
            error: RunnerFailure::Llm { message, status },
            partial,
        } = &failed
        else {
            panic!("{failed:?}");
        };
        assert_eq!(message.chars().count(), 2000);
        assert_eq!(*status, Some(401));
        assert_eq!(*partial, None);
        let json = serde_json::to_value(&failed).unwrap();
        assert_eq!(json["outcome"], "failed");
        assert_eq!(json["error"]["code"], "llm");
        assert_eq!(json["error"]["status"], 401);
        for (result, expected) in [
            (
                TakeResult::Failed {
                    error: RunnerFailure::Connection,
                    partial: None,
                },
                serde_json::json!({ "outcome": "failed", "error": { "code": "connection" } }),
            ),
            (
                TakeResult::Failed {
                    error: RunnerFailure::Expired,
                    partial: None,
                },
                serde_json::json!({ "outcome": "failed", "error": { "code": "expired" } }),
            ),
            (
                TakeResult::Failed {
                    error: RunnerFailure::InvalidResult,
                    partial: None,
                },
                serde_json::json!({ "outcome": "failed", "error": { "code": "invalid-result" } }),
            ),
            (
                TakeResult::Failed {
                    error: RunnerFailure::Error {
                        message: "m".into(),
                    },
                    partial: None,
                },
                serde_json::json!({ "outcome": "failed", "error": { "code": "error", "message": "m" } }),
            ),
            (
                TakeResult::cancelled(),
                serde_json::json!({ "outcome": "cancelled" }),
            ),
        ] {
            assert_eq!(serde_json::to_value(&result).unwrap(), expected);
        }
    }

    #[test]
    fn bundle_output_is_checked_and_only_classify_keeps_partial() {
        let partial = serde_json::json!({ "outcome": "cancelled", "partial": [{ "group": 0, "suggestions": [{ "ref": "0" }] }] }).to_string();
        let kept = interpret(AnalysisKind::Classify, partial.as_bytes());
        assert!(matches!(&kept, TakeResult::Cancelled { partial: Some(p) } if p.len() == 1));
        assert_eq!(
            interpret(AnalysisKind::Order, partial.as_bytes()),
            TakeResult::cancelled()
        );
        let out_of_range = serde_json::json!({ "outcome": "cancelled", "partial": [{ "group": 2, "suggestions": [] }] }).to_string();
        assert_eq!(
            interpret(AnalysisKind::Classify, out_of_range.as_bytes()),
            TakeResult::cancelled()
        );
        let invalid = TakeResult::Failed {
            error: RunnerFailure::InvalidResult,
            partial: None,
        };
        for bad in [
            "",
            "not json",
            "[]",
            r#"{"outcome":"done","result":[1]}"#,
            r#"{"outcome":"done","result":"x"}"#,
            r#"{"outcome":"done","result":{},"extra":1}"#,
            r#"{"outcome":"failed","error":{"code":"expired"}}"#,
            r#"{"outcome":"failed","error":{"code":"invalid-result"}}"#,
            r#"{"outcome":"failed","error":{"code":"llm","message":"x","extra":1}}"#,
            r#"{"outcome":"weird"}"#,
        ] {
            assert_eq!(
                interpret(AnalysisKind::Receipt, bad.as_bytes()),
                invalid,
                "{bad}"
            );
        }
        let big = format!(
            r#"{{"outcome":"done","result":{{"x":"{}"}}}}"#,
            "a".repeat(MAX_RESULT_BYTES)
        );
        assert_eq!(interpret(AnalysisKind::Receipt, big.as_bytes()), invalid);
        let ok = interpret(
            AnalysisKind::Receipt,
            br#"{"outcome":"done","result":{"date":"2026-01-01"}}"#,
        );
        assert!(matches!(ok, TakeResult::Done { .. }));
    }

    #[derive(Default)]
    struct FakeNative {
        starts: Mutex<Vec<(u64, Vec<u8>, Vec<u8>, String, String)>>,
        engines: Mutex<Vec<(u32, Option<Vec<u8>>)>>,
        cancels: Mutex<Vec<u64>>,
        replies: Mutex<Vec<(u64, u64, Option<Vec<u8>>)>>,
        posts: Mutex<Vec<(AnalysisKind, String)>>,
        ai_calls: Mutex<Vec<(i32, Vec<u8>)>>,
        refuse_start: AtomicBool,
        // 0 のときは refuse_start に従う。それ以外はこの答えを返す。
        start_answer: std::sync::atomic::AtomicI32,
        active: AtomicBool,
        status: Mutex<Option<NotifyStatus>>,
        // OS の AI の偽物を止めておく門。Some(false) の間は戻らない。
        ai_gate: Mutex<Option<bool>>,
        ai_gate_changed: Condvar,
    }

    impl FakeNative {
        fn record_ai(&self, task: i32, payload: &[u8]) {
            self.ai_calls.lock().unwrap().push((task, payload.to_vec()));
            let mut gate = self.ai_gate.lock().unwrap();
            while *gate == Some(false) {
                gate = self.ai_gate_changed.wait(gate).unwrap();
            }
        }
    }

    impl RunnerNative for Arc<FakeNative> {
        fn start(&self, token: u64, start: NativeStart) -> i32 {
            self.starts.lock().unwrap().push((
                token,
                start.script,
                start.spec,
                start.text.title.to_str().unwrap().to_string(),
                start.text.subtitle.to_str().unwrap().to_string(),
            ));
            self.engines
                .lock()
                .unwrap()
                .push((start.engine, start.image));
            let answer = self.start_answer.load(Ordering::SeqCst);
            if answer != 0 {
                return answer;
            }
            i32::from(self.refuse_start.load(Ordering::SeqCst))
        }
        fn ai_extract(&self, image: &[u8]) -> Result<String, u8> {
            self.record_ai(0, image);
            Ok(r#"{"vendor":"v"}"#.to_string())
        }
        fn ai_run(&self, task: i32, data: &str) -> Result<String, u8> {
            self.record_ai(task, data.as_bytes());
            Ok(format!("{{\"task\":{task}}}"))
        }
        fn cancel(&self, token: u64) {
            self.cancels.lock().unwrap().push(token);
        }
        fn reply(&self, token: u64, request: u64, body: Option<Vec<u8>>) {
            self.replies.lock().unwrap().push((token, request, body));
        }
        fn app_active(&self) -> bool {
            self.active.load(Ordering::SeqCst)
        }
        fn notify_status(&self) -> NotifyStatus {
            self.status.lock().unwrap().unwrap_or(NotifyStatus::Granted)
        }
        fn post(&self, kind: AnalysisKind, text: notify::Text) -> bool {
            self.posts
                .lock()
                .unwrap()
                .push((kind, text.body.to_str().unwrap().to_string()));
            true
        }
    }

    #[derive(Default)]
    struct FakeNet {
        fetched: AtomicUsize,
        hold: AtomicBool,
    }

    impl RunnerNet for Arc<FakeNet> {
        fn url_allowed(&self, raw: &str) -> bool {
            app_like(raw)
        }
        fn fetch(&self, frame: Vec<u8>, _origin: String) -> Option<FetchFuture> {
            self.fetched.fetch_add(1, Ordering::SeqCst);
            let hold = self.hold.load(Ordering::SeqCst);
            Some(Box::pin(async move {
                if hold {
                    std::future::pending::<()>().await;
                }
                Some(frame)
            }))
        }
    }

    fn script() -> Vec<u8> {
        let mut bytes = RUNNER_MARKER.to_vec();
        bytes.extend_from_slice(b"\n(()=>{})();");
        bytes
    }

    type TestRunner = Runner<Arc<FakeNative>>;

    fn runner_with(loader: ScriptLoader) -> (&'static TestRunner, Arc<FakeNative>, Arc<FakeNet>) {
        let native = Arc::new(FakeNative::default());
        let net = Arc::new(FakeNet::default());
        let runner = Box::leak(Box::new(Runner::new(
            native.clone(),
            Box::new(net.clone()),
            loader,
        )));
        (runner, native, net)
    }

    fn runner() -> (&'static TestRunner, Arc<FakeNative>, Arc<FakeNet>) {
        runner_with(Box::new(|_| Some(script())))
    }

    fn job(raw: &str) -> JobId {
        JobId::parse(raw).unwrap()
    }

    fn last_token(native: &FakeNative) -> u64 {
        native.starts.lock().unwrap().last().unwrap().0
    }

    fn done_bytes() -> Vec<u8> {
        br#"{"outcome":"done","result":{"vendor":"x"}}"#.to_vec()
    }

    #[test]
    fn a_second_start_while_a_job_runs_is_start_failed() {
        let (runner, native, _) = runner();
        runner.start(openai_spec()).unwrap();
        let mut second = openai_spec();
        second["job"] = "page-1-job2".into();
        assert_eq!(runner.start(second.clone()), Err(StartError::StartFailed));
        runner.complete(last_token(&native), &done_bytes());
        assert!(runner.start(second).is_ok());
    }

    #[test]
    fn a_refused_start_registers_no_job() {
        let (runner, native, _) = runner();
        let mut bad = openai_spec();
        bad["adapter"]["baseUrl"] = "http://192.168.1.2/".into();
        assert_eq!(runner.start(bad), Err(StartError::DisallowedUrl));
        assert!(native.starts.lock().unwrap().is_empty());
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
        native.refuse_start.store(true, Ordering::SeqCst);
        assert_eq!(runner.start(openai_spec()), Err(StartError::StartFailed));
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
        native.refuse_start.store(false, Ordering::SeqCst);
        assert!(runner.start(openai_spec()).is_ok());
    }

    #[test]
    fn a_missing_or_foreign_asset_is_start_failed() {
        let (runner, native, _) = runner_with(Box::new(|_| None));
        assert_eq!(runner.start(openai_spec()), Err(StartError::StartFailed));
        let (runner, _, _) = runner_with(Box::new(|_| Some(b"<!doctype html>".to_vec())));
        assert_eq!(runner.start(openai_spec()), Err(StartError::StartFailed));
        assert!(native.starts.lock().unwrap().is_empty());
        assert_eq!(RunnerAsset::Runner.path(), "native-runner/runner.js");
    }

    #[test]
    fn swift_receives_the_script_the_validated_spec_and_fixed_texts() {
        let (runner, native, _) = runner();
        runner.start(openai_spec()).unwrap();
        let starts = native.starts.lock().unwrap();
        let (_, script_bytes, spec, title, subtitle) = starts.last().unwrap();
        assert_eq!(script_bytes, &script());
        let spec: Value = serde_json::from_slice(spec).unwrap();
        assert_eq!(spec, openai_spec());
        let text = notify::background_text(UiLocale::Ja, AnalysisKind::Order);
        assert_eq!(title, text.title.to_str().unwrap());
        assert_eq!(subtitle, text.subtitle.to_str().unwrap());
    }

    #[test]
    fn a_done_job_is_delivered_once_and_notifies_only_when_away_and_granted() {
        let (runner, native, _) = runner();
        runner.start(openai_spec()).unwrap();
        runner.complete(last_token(&native), &done_bytes());
        let result = runner.take(&job("page-1-job"));
        assert!(matches!(result, TakeResult::Done { .. }));
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
        let body = notify::text(UiLocale::Ja, AnalysisKind::Order, Outcome::Done)
            .body
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(
            *native.posts.lock().unwrap(),
            vec![(AnalysisKind::Order, body)]
        );

        native.active.store(true, Ordering::SeqCst);
        runner.start(openai_spec()).unwrap();
        runner.complete(last_token(&native), &done_bytes());
        assert_eq!(native.posts.lock().unwrap().len(), 1);

        native.active.store(false, Ordering::SeqCst);
        *native.status.lock().unwrap() = Some(NotifyStatus::Denied);
        runner.start(openai_spec()).unwrap();
        runner.complete(last_token(&native), &done_bytes());
        assert_eq!(native.posts.lock().unwrap().len(), 1);

        *native.status.lock().unwrap() = Some(NotifyStatus::Granted);
        let mut quiet = openai_spec();
        quiet["notify"] = false.into();
        runner.start(quiet).unwrap();
        runner.complete(last_token(&native), &done_bytes());
        assert_eq!(native.posts.lock().unwrap().len(), 1);

        runner.start(openai_spec()).unwrap();
        runner.complete(
            last_token(&native),
            br#"{"outcome":"failed","error":{"code":"connection"}}"#,
        );
        let failed = notify::text(UiLocale::Ja, AnalysisKind::Order, Outcome::Failed)
            .body
            .to_str()
            .unwrap()
            .to_string();
        assert_eq!(
            native.posts.lock().unwrap().last().unwrap(),
            &(AnalysisKind::Order, failed)
        );
    }

    #[test]
    fn take_waits_for_the_end_of_the_job() {
        let (runner, native, _) = runner();
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        let waiter = std::thread::spawn(move || runner.take(&job("page-1-job")));
        std::thread::sleep(Duration::from_millis(100));
        assert!(!waiter.is_finished());
        runner.complete(token, &done_bytes());
        assert!(matches!(waiter.join().unwrap(), TakeResult::Done { .. }));
    }

    #[test]
    fn a_user_cancelled_classify_keeps_partial() {
        let (runner, native, _) = runner();
        runner
            .start(classify_spec(serde_json::json!([
                group("debit"),
                group("credit")
            ])))
            .unwrap();
        let token = last_token(&native);
        runner.cancel(&job("c-1"));
        assert_eq!(*native.cancels.lock().unwrap(), vec![token]);
        runner.complete(
            token,
            serde_json::json!({ "outcome": "cancelled", "partial": [{ "group": 0, "suggestions": [{ "ref": "0" }] }] }).to_string().as_bytes(),
        );
        let result = runner.take(&job("c-1"));
        assert!(
            matches!(&result, TakeResult::Cancelled { partial: Some(p) } if p.len() == 1),
            "{result:?}"
        );
        assert!(native.posts.lock().unwrap().is_empty());
    }
    // A6：Swift は complete の戻り値で背景処理を閉じる。true は done に決まったときだけ。
    // A-1：runner.js の無いビルドでは印を出さず、従来の web view の経路のままにする。
    #[test]
    fn the_runner_flag_needs_the_real_asset_outside_dev() {
        let real = [RUNNER_MARKER, b"\n(()=>{})();".as_slice()].concat();
        let index = b"<!doctype html><html><head><title>aoiko</title></head></html>";
        assert_eq!(runner_flag_script(false, Some(&real)), RUNNER_FLAG_SCRIPT);
        assert_eq!(runner_flag_script(false, None), "");
        assert_eq!(runner_flag_script(false, Some(index)), "");
        assert_eq!(runner_flag_script(false, Some(b"")), "");
        assert_eq!(runner_flag_script(false, Some(&RUNNER_MARKER[1..])), "");
        assert_eq!(runner_flag_script(true, Some(&real)), "");
        assert_eq!(runner_flag_script(true, None), "");
    }

    #[test]
    fn complete_reports_done_only_when_the_job_ends_done() {
        let fresh = runner;
        let failed = br#"{"outcome":"failed","error":{"code":"connection"}}"#;
        let cancelled = br#"{"outcome":"cancelled"}"#;
        for (bytes, done) in [
            (done_bytes(), true),
            (failed.to_vec(), false),
            (cancelled.to_vec(), false),
            (b"not json".to_vec(), false),
            (br#"{"outcome":"done","result":[]}"#.to_vec(), false),
        ] {
            let (runner, native, _) = fresh();
            runner.start(openai_spec()).unwrap();
            let token = last_token(&native);
            assert_eq!(runner.complete(token, &bytes), done, "{bytes:?}");
        }
        let (runner, native, _) = fresh();
        assert!(!runner.complete(1, &done_bytes()));
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        // 別のトークンの報告ではジョブは終わらない。
        assert!(!runner.complete(token.wrapping_add(1), &done_bytes()));
        runner.cancel(&job("page-1-job"));
        assert!(!runner.complete(token, &done_bytes()));
        let (runner, native, _) = fresh();
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        runner.expired(token);
        assert!(!runner.complete(token, &done_bytes()));
        let (runner, native, _) = fresh();
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        runner.page_load(true);
        assert!(!runner.complete(token, &done_bytes()));
    }
    // A2：取消しが届いたときには全グループが終わっていた。終わっていたグループとして全部を返す。
    #[test]
    fn a_user_cancelled_classify_that_finished_returns_every_group_as_partial() {
        let (runner, native, _) = runner();
        runner
            .start(classify_spec(serde_json::json!([
                group("debit"),
                group("credit")
            ])))
            .unwrap();
        let token = last_token(&native);
        runner.cancel(&job("c-1"));
        runner.complete(
            token,
            serde_json::json!({ "outcome": "done", "result": { "suggestions": [[{ "ref": "0" }], [{ "ref": "1" }, { "ref": "2" }]] } }).to_string().as_bytes(),
        );
        let result = runner.take(&job("c-1"));
        let expected: Value = serde_json::json!({
            "outcome": "cancelled",
            "partial": [
                { "group": 0, "suggestions": [{ "ref": "0" }] },
                { "group": 1, "suggestions": [{ "ref": "1" }, { "ref": "2" }] }
            ]
        });
        assert_eq!(serde_json::to_value(&result).unwrap(), expected);
        assert!(native.posts.lock().unwrap().is_empty());
    }

    #[test]
    fn a_user_cancelled_done_without_usable_groups_is_a_plain_cancel() {
        let cases = [
            serde_json::json!({ "suggestions": [[], [], []] }),
            serde_json::json!({ "suggestions": [[], "x"] }),
            serde_json::json!({ "suggestions": "x" }),
            serde_json::json!({ "vendor": "x" }),
        ];
        for result in cases {
            let (runner, native, _) = runner();
            runner
                .start(classify_spec(serde_json::json!([group("debit")])))
                .unwrap();
            let token = last_token(&native);
            runner.cancel(&job("c-1"));
            let bytes = serde_json::json!({ "outcome": "done", "result": result }).to_string();
            runner.complete(token, bytes.as_bytes());
            assert_eq!(
                runner.take(&job("c-1")),
                TakeResult::cancelled(),
                "{result}"
            );
        }
        // 分類以外は従来どおり partial を持たない。
        let (runner, native, _) = runner();
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        runner.cancel(&job("page-1-job"));
        runner.complete(
            token,
            br#"{"outcome":"done","result":{"suggestions":[[]]}}"#,
        );
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
    }

    #[test]
    fn a_page_load_cancels_only_jobs_of_an_earlier_generation() {
        let (runner, native, _) = runner();
        runner.page_load(true);
        runner
            .start(classify_spec(serde_json::json!([group("debit")])))
            .unwrap();
        let old = last_token(&native);
        // 同じ読み込みの終わりでは取り消さない。
        runner.page_load(false);
        assert!(native.cancels.lock().unwrap().is_empty());
        runner.page_load(true);
        assert_eq!(*native.cancels.lock().unwrap(), vec![old]);
        assert_eq!(runner.take(&job("c-1")), TakeResult::cancelled());
        // Swift が手放すまでは次を始めない。
        let mut next = openai_spec();
        next["job"] = "page-2-job".into();
        assert_eq!(runner.start(next.clone()), Err(StartError::StartFailed));
        runner.complete(
            old,
            serde_json::json!({ "outcome": "cancelled", "partial": [{ "group": 0, "suggestions": [] }] }).to_string().as_bytes(),
        );
        runner.start(next).unwrap();
        runner.page_load(false);
        assert_eq!(native.cancels.lock().unwrap().len(), 1);
        runner.complete(last_token(&native), &done_bytes());
        assert!(matches!(
            runner.take(&job("page-2-job")),
            TakeResult::Done { .. }
        ));
    }
    // A1：開始の途中（Swift がジョブを積む前）にページが読み込まれると、取消しが開始より先に Swift へ届く。
    #[derive(Default)]
    struct RacingNative {
        runner: OnceLock<&'static Runner<Arc<RacingNative>>>,
        race: AtomicBool,
        events: Mutex<Vec<String>>,
        replies: AtomicUsize,
    }

    impl RunnerNative for Arc<RacingNative> {
        fn start(&self, token: u64, _start: NativeStart) -> i32 {
            if self.race.swap(false, Ordering::SeqCst) {
                if let Some(runner) = self.runner.get() {
                    runner.page_load(true);
                }
            }
            self.events.lock().unwrap().push(format!("start {token}"));
            NATIVE_STARTED
        }
        fn ai_extract(&self, _image: &[u8]) -> Result<String, u8> {
            Err(AI_OTHER)
        }
        fn ai_run(&self, _task: i32, _data: &str) -> Result<String, u8> {
            Err(AI_OTHER)
        }
        fn cancel(&self, token: u64) {
            self.events.lock().unwrap().push(format!("cancel {token}"));
        }
        fn reply(&self, _token: u64, _request: u64, _body: Option<Vec<u8>>) {
            self.replies.fetch_add(1, Ordering::SeqCst);
        }
        fn app_active(&self) -> bool {
            false
        }
        fn notify_status(&self) -> NotifyStatus {
            NotifyStatus::Granted
        }
        fn post(&self, _kind: AnalysisKind, _text: notify::Text) -> bool {
            true
        }
    }

    #[test]
    fn a_page_load_during_start_is_cleared_only_by_the_swift_completion() {
        let native = Arc::new(RacingNative::default());
        native.race.store(true, Ordering::SeqCst);
        let runner: &'static Runner<Arc<RacingNative>> = Box::leak(Box::new(Runner::new(
            native.clone(),
            Box::new(Arc::new(FakeNet::default())),
            Box::new(|_| Some(script())),
        )));
        let _ = native.runner.set(runner);
        runner.start(openai_spec()).unwrap();
        assert_eq!(
            *native.events.lock().unwrap(),
            vec!["cancel 1".to_string(), "start 1".to_string()]
        );
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
        // 決まったジョブの通信には応答しない。Swift が自分で終えない限り busy のまま。
        runner.fetch(1, 1, b"frame".to_vec());
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(native.replies.load(Ordering::SeqCst), 0);
        let mut next = openai_spec();
        next["job"] = "page-2-job".into();
        assert_eq!(runner.start(next.clone()), Err(StartError::StartFailed));
        // 取消しを覚えていた Swift が報告する形。
        runner.complete(1, br#"{"outcome":"cancelled"}"#);
        assert!(runner.start(next).is_ok());
    }

    #[test]
    fn a_cancel_before_start_leaves_a_tombstone() {
        let (runner, native, _) = runner();
        runner.cancel(&job("page-1-job"));
        assert!(runner.start(openai_spec()).is_ok());
        assert!(native.starts.lock().unwrap().is_empty());
        assert_eq!(runner.take(&job("page-1-job")), TakeResult::cancelled());
        // 知らない識別子の取消しは何も起こさない。
        runner.cancel(&job("never"));
        assert!(native.cancels.lock().unwrap().is_empty());
    }

    #[test]
    fn expiry_fails_the_job_cuts_requests_and_notifies_once() {
        let (runner, native, net) = runner();
        net.hold.store(true, Ordering::SeqCst);
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        tauri::async_runtime::block_on(async {
            runner.fetch(token, 1, b"frame".to_vec());
        });
        assert_eq!(net.fetched.load(Ordering::SeqCst), 1);
        runner.expired(token);
        runner.expired(token);
        assert_eq!(
            runner.take(&job("page-1-job")),
            TakeResult::Failed {
                error: RunnerFailure::Expired,
                partial: None
            }
        );
        assert_eq!(*native.cancels.lock().unwrap(), vec![token]);
        assert_eq!(native.posts.lock().unwrap().len(), 1);
        // 終わった後の応答も結果も捨てる。busy は Swift の報告で解ける。
        runner.complete(token, &done_bytes());
        assert_eq!(native.posts.lock().unwrap().len(), 1);
        assert!(native.replies.lock().unwrap().is_empty());
        assert!(runner.start(openai_spec()).is_ok());
    }

    #[test]
    fn replies_reach_only_the_current_job() {
        let (runner, native, net) = runner();
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        runner.fetch(token, 7, b"frame".to_vec());
        for _ in 0..50 {
            if !native.replies.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            *native.replies.lock().unwrap(),
            vec![(token, 7, Some(b"frame".to_vec()))]
        );
        runner.fetch(token.wrapping_add(1), 8, b"frame".to_vec());
        assert_eq!(net.fetched.load(Ordering::SeqCst), 1);
        runner.fetched(token.wrapping_add(1), 9, Some(Vec::new()));
        assert_eq!(native.replies.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_job_without_a_registered_fetcher_gets_a_failed_reply() {
        let native = Arc::new(FakeNative::default());
        let runner: &'static TestRunner = Box::leak(Box::new(Runner::new(
            native.clone(),
            global_net(),
            Box::new(|_| Some(script())),
        )));
        let mut spec = gemini_spec();
        spec["job"] = "solo".into();
        runner.start(spec).unwrap();
        let token = last_token(&native);
        runner.fetch(token, 1, b"frame".to_vec());
        assert_eq!(*native.replies.lock().unwrap(), vec![(token, 1, None)]);
    }
    // 端末内のエンジン。
    fn local_spec(kind: &str, engine: &str) -> Value {
        let input = match kind {
            "receipt" => {
                serde_json::json!({ "image": { "base64": "AQID", "mimeType": "image/png" } })
            }
            "order" => serde_json::json!({ "text": "注文" }),
            _ => serde_json::json!({ "groups": [group("debit")] }),
        };
        serde_json::json!({
            "job": format!("local-{kind}-{engine}"),
            "kind": kind,
            "engine": engine,
            "locale": "ja",
            "notify": true,
            "input": input
        })
    }

    #[test]
    fn local_engines_take_only_their_pairs_and_no_adapter() {
        for (kind, engine) in [
            ("receipt", "tesseract"),
            ("receipt", "native"),
            ("receipt", "apple-ai"),
            ("order", "apple-ai"),
            ("classify", "apple-ai"),
        ] {
            let validated = check(local_spec(kind, engine)).unwrap();
            assert_eq!(validated.origin, None, "{kind} {engine}");
            let out = serde_json::to_value(&validated.spec).unwrap();
            assert_eq!(out, local_spec(kind, engine), "{kind} {engine}");
        }
        for (kind, engine) in [
            ("order", "tesseract"),
            ("order", "native"),
            ("classify", "tesseract"),
            ("classify", "native"),
        ] {
            assert_eq!(
                check(local_spec(kind, engine)).err(),
                Some(StartError::StartFailed),
                "{kind} {engine}"
            );
        }
        let mut with_adapter = local_spec("receipt", "tesseract");
        with_adapter["adapter"] = serde_json::json!({ "model": "m", "apiKey": "" });
        assert_eq!(check(with_adapter).err(), Some(StartError::StartFailed));
        let mut llm_without_adapter = openai_spec();
        llm_without_adapter
            .as_object_mut()
            .unwrap()
            .remove("adapter");
        assert_eq!(
            check(llm_without_adapter).err(),
            Some(StartError::StartFailed)
        );
    }

    #[test]
    fn a_fetch_from_a_local_engine_job_never_reaches_the_network() {
        let (runner, native, net) = runner();
        runner.start(local_spec("order", "apple-ai")).unwrap();
        let token = last_token(&native);
        runner.fetch(token, 1, b"frame".to_vec());
        assert_eq!(net.fetched.load(Ordering::SeqCst), 0);
        assert_eq!(*native.replies.lock().unwrap(), vec![(token, 1, None)]);
    }

    #[test]
    fn swift_gets_the_engine_code_and_the_decoded_image_only_for_local_receipts() {
        let (runner, native, _) = runner();
        for (spec, engine, image) in [
            (openai_spec(), 0, None),
            (gemini_spec(), 0, None),
            (local_spec("order", "apple-ai"), 0, None),
            (local_spec("classify", "apple-ai"), 0, None),
            (local_spec("receipt", "tesseract"), 1, Some(vec![1, 2, 3])),
            (local_spec("receipt", "native"), 2, Some(vec![1, 2, 3])),
            (local_spec("receipt", "apple-ai"), 3, Some(vec![1, 2, 3])),
        ] {
            runner.start(spec).unwrap();
            let last = native.engines.lock().unwrap().last().cloned().unwrap();
            assert_eq!(last, (engine, image));
            runner.complete(last_token(&native), &done_bytes());
        }
        let mut broken = local_spec("receipt", "tesseract");
        broken["input"]["image"]["base64"] = "not base64!".into();
        let before = native.starts.lock().unwrap().len();
        assert_eq!(runner.start(broken), Err(StartError::StartFailed));
        assert_eq!(native.starts.lock().unwrap().len(), before);
    }

    #[test]
    fn use_webview_only_for_local_receipts_and_it_leaves_no_job() {
        let (runner, native, _) = runner();
        native
            .start_answer
            .store(NATIVE_USE_WEBVIEW, Ordering::SeqCst);
        // LLM の仕様（大きすぎる画像でも）に Swift が 2 を返しても web view へは戻さない。
        for spec in [
            openai_spec(),
            gemini_spec(),
            local_spec("order", "apple-ai"),
        ] {
            assert_eq!(runner.start(spec), Err(StartError::StartFailed));
        }
        for engine in ["tesseract", "native", "apple-ai"] {
            let spec = local_spec("receipt", engine);
            let job_id = job(spec["job"].as_str().unwrap());
            assert_eq!(runner.start(spec), Err(StartError::UseWebview));
            assert_eq!(runner.take(&job_id), TakeResult::cancelled());
        }
        native.start_answer.store(0, Ordering::SeqCst);
        assert!(runner.start(local_spec("receipt", "tesseract")).is_ok());
    }

    #[test]
    fn a_refused_start_clears_a_result_left_by_a_page_load_during_the_start() {
        let (runner, native, _) = runner();
        native
            .start_answer
            .store(NATIVE_USE_WEBVIEW, Ordering::SeqCst);
        let spec = local_spec("receipt", "tesseract");
        let job_id = job(spec["job"].as_str().unwrap());
        {
            let mut state = runner.locked();
            state.finished = Some((job_id.clone(), TakeResult::cancelled()));
        }
        assert_eq!(runner.start(spec), Err(StartError::UseWebview));
        assert!(runner.locked().finished.is_none());
        assert!(runner.locked().active.is_none());
    }

    fn ai_call(runner: &TestRunner, token: u64, payload: &[u8]) -> (Option<String>, i32) {
        let mut code: i32 = -1;
        let ptr = runner.ai_raw(token, payload.as_ptr(), payload.len(), &mut code);
        if ptr.is_null() {
            return (None, code);
        }
        let text = unsafe { std::ffi::CStr::from_ptr(ptr) }
            .to_str()
            .unwrap()
            .to_string();
        unsafe { ai_release(ptr) };
        (Some(text), code)
    }

    #[test]
    fn the_ai_entry_derives_the_task_from_the_job_and_gives_fixed_codes() {
        let (runner, native, _) = runner();
        assert_eq!(ai_call(runner, 1, b"x"), (None, i32::from(AI_OTHER)));
        runner.start(local_spec("order", "apple-ai")).unwrap();
        let token = last_token(&native);
        assert_eq!(
            ai_call(runner, token, "注文".as_bytes()),
            (Some("{\"task\":2}".to_string()), 0)
        );
        assert_eq!(ai_call(runner, token, b""), (None, 2));
        assert_eq!(ai_call(runner, token, &[0xff, 0xfe]), (None, 2));
        let mut code = -1;
        assert!(runner
            .ai_raw(token, std::ptr::null(), 3, &mut code)
            .is_null());
        assert_eq!(code, 2);
        assert!(runner
            .ai_raw(token, b"x".as_ptr(), 1, std::ptr::null_mut())
            .is_null());
        let over = vec![b'a'; APPLE_AI_DATA_CEILING_BYTES + 1];
        assert_eq!(ai_call(runner, token, &over), (None, 7));
        assert_eq!(
            ai_call(runner, token + 1, b"x"),
            (None, i32::from(AI_OTHER))
        );
        runner.complete(token, &done_bytes());
        assert_eq!(ai_call(runner, token, b"x"), (None, i32::from(AI_OTHER)));
        runner.start(local_spec("classify", "apple-ai")).unwrap();
        let token = last_token(&native);
        assert_eq!(
            ai_call(runner, token, b"{}"),
            (Some("{\"task\":1}".to_string()), 0)
        );
        runner.complete(token, &done_bytes());
        runner.start(local_spec("receipt", "apple-ai")).unwrap();
        let token = last_token(&native);
        assert_eq!(
            ai_call(runner, token, &[1, 2, 3]),
            (Some(r#"{"vendor":"v"}"#.to_string()), 0)
        );
        assert_eq!(
            native.ai_calls.lock().unwrap().last().cloned(),
            Some((0, vec![1, 2, 3]))
        );
        runner.complete(token, &done_bytes());
        // LLM のジョブからは呼べない。
        runner.start(openai_spec()).unwrap();
        let token = last_token(&native);
        assert_eq!(ai_call(runner, token, b"x"), (None, i32::from(AI_OTHER)));
        assert_eq!(APPLE_AI_IMAGE_CEILING_BYTES, 64 * 1024 * 1024);
        assert_eq!(APPLE_AI_DATA_CEILING_BYTES, 8 * 1024 * 1024);
    }

    #[test]
    fn the_job_stays_busy_until_the_native_ai_call_returns() {
        let (runner, native, _) = runner();
        runner.start(local_spec("order", "apple-ai")).unwrap();
        let token = last_token(&native);
        *native.ai_gate.lock().unwrap() = Some(false);
        let caller = std::thread::spawn(move || ai_call(runner, token, b"x"));
        while native.ai_calls.lock().unwrap().is_empty() {
            std::thread::sleep(Duration::from_millis(5));
        }
        // Swift が先に閉じても、呼び出しが戻るまでは次を始めさせない。
        runner.complete(token, &done_bytes());
        let mut next = openai_spec();
        next["job"] = "after-ai".into();
        assert_eq!(runner.start(next.clone()), Err(StartError::StartFailed));
        *native.ai_gate.lock().unwrap() = Some(true);
        native.ai_gate_changed.notify_all();
        assert_eq!(caller.join().unwrap().1, 0);
        assert!(runner.start(next).is_ok());
    }

    fn assets(index_html_everywhere: bool, traineddata_len: usize) -> ScriptLoader {
        Box::new(move |asset| {
            if index_html_everywhere {
                return Some(b"<!doctype html><html></html>".to_vec());
            }
            match asset {
                RunnerAsset::TesseractCore | RunnerAsset::TesseractCoreFallback => {
                    let mut wasm = b"\0asm\x01\0\0\0".to_vec();
                    wasm.extend_from_slice(&[1, 2, 3]);
                    Some(wasm)
                }
                RunnerAsset::JpnTraineddata => Some(vec![7; 10]),
                RunnerAsset::AssetManifest => {
                    Some(format!("{{\"jpnTraineddata\":{traineddata_len}}}").into_bytes())
                }
                RunnerAsset::Runner => Some(script()),
            }
        })
    }

    fn handed(runner: &TestRunner, code: u32, with_len: bool) -> (*mut u8, usize) {
        let mut len: usize = 99;
        let out = if with_len {
            &mut len as *mut usize
        } else {
            std::ptr::null_mut()
        };
        let ptr = asset_raw(|code| runner.asset(code), code, out);
        (ptr, len)
    }

    #[test]
    fn only_codes_one_to_three_hand_out_assets_and_the_free_pairs_with_them() {
        let (runner, _, _) = runner_with(assets(false, 10));
        for (code, first) in [(1u32, 0u8), (2, 0), (3, 7)] {
            let (ptr, len) = handed(runner, code, true);
            assert!(!ptr.is_null(), "{code}");
            let copy = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
            assert_eq!(copy.first(), Some(&first), "{code}");
            assert_eq!(len, if code == 3 { 10 } else { 11 });
            unsafe { asset_release(ptr, len) };
        }
        for code in [0u32, 4, u32::MAX] {
            let (ptr, len) = handed(runner, code, true);
            assert!(ptr.is_null(), "{code}");
            assert_eq!(len, 0, "{code}");
        }
        let (ptr, len) = handed(runner, 1, false);
        assert!(ptr.is_null());
        assert_eq!(len, 99);
        unsafe { asset_release(std::ptr::null_mut(), 5) };
        assert_eq!(
            RunnerAsset::TesseractCore.path(),
            "tesseract/tesseract-core.wasm"
        );
        assert_eq!(
            RunnerAsset::TesseractCoreFallback.path(),
            "tesseract/tesseract-core-fallback.wasm"
        );
        assert_eq!(
            RunnerAsset::JpnTraineddata.path(),
            "tesseract/jpn.traineddata"
        );
        assert_eq!(
            RunnerAsset::AssetManifest.path(),
            "native-runner/assets.json"
        );
    }

    #[test]
    fn an_index_html_fallback_or_a_wrong_length_hands_out_nothing() {
        let (runner, _, _) = runner_with(assets(true, 10));
        for code in [1u32, 2, 3] {
            assert!(handed(runner, code, true).0.is_null(), "{code}");
        }
        let (runner, _, _) = runner_with(assets(false, 11));
        assert!(handed(runner, 3, true).0.is_null());
        let (runner, _, _) = runner_with(Box::new(|asset| match asset {
            RunnerAsset::JpnTraineddata => Some(vec![7; 10]),
            _ => None,
        }));
        assert!(handed(runner, 3, true).0.is_null());
        let (runner, _, _) = runner_with(Box::new(|_| Some(Vec::new())));
        for code in [1u32, 2, 3] {
            assert!(handed(runner, code, true).0.is_null(), "{code}");
        }
    }
    // swift-rs は Cargo のデバッグ情報が有効なとき Swift を debug で組む（DEBUG の区画が入る）。
    #[test]
    fn the_release_profile_has_no_debug_key() {
        let cargo = include_str!("../../../Cargo.toml");
        let release = cargo
            .split("[profile.release]")
            .nth(1)
            .and_then(|rest| rest.split("\n[").next())
            .unwrap();
        assert!(release.contains("panic = \"abort\""));
        assert!(!release
            .lines()
            .any(|line| line.trim_start().starts_with("debug")));
    }
    // ここから下は Swift から呼ばれる入口の書かれ方の固定。リリースは panic = "abort" なので、
    // catch_unwind に頼らず、panic し得る書き方が無いことを見る。
    fn ios_source() -> &'static str {
        include_str!("runner.rs")
            .split("pub(crate) mod ios {")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .expect("mod ios が見つからない")
    }
    // シグネチャの行（引数の型を含む）を除いた本体。型の [ や >> は実行される式ではない。
    fn body<'a>(source: &'a str, head: &str) -> &'a str {
        source
            .split(head)
            .nth(1)
            .and_then(|rest| rest.split("\n    }\n").next())
            .and_then(|rest| rest.split_once('\n'))
            .map(|(_, rest)| rest)
            .expect(head)
    }
    // 行頭から始まる関数（mod の外）の本体。閉じ括弧は行頭の }。
    fn top_body<'a>(source: &'a str, head: &str) -> &'a str {
        source
            .split(head)
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .and_then(|rest| rest.split_once(") -> ").or_else(|| rest.split_once(") {")))
            .and_then(|(_, rest)| rest.split_once('\n'))
            .map(|(_, rest)| rest)
            .expect(head)
    }

    #[test]
    fn swift_entries_cannot_panic_by_construction() {
        // Swift が呼ぶ Rust の関数は、ジョブの 3 つと、アセットの 2 つ、OS の AI の 2 つだけ。
        assert_eq!(ios_source().matches("extern \"C\" fn ").count(), 7);
        let source = include_str!("runner.rs");
        for head in [
            "extern \"C\" fn on_fetch(",
            "extern \"C\" fn on_complete(",
            "extern \"C\" fn on_expired(",
            "extern \"C\" fn on_asset(",
            "extern \"C\" fn on_asset_free(",
            "extern \"C\" fn aoiko_runner_ai(",
            "extern \"C\" fn aoiko_runner_ai_free(",
            "fn copy_bytes(",
        ] {
            assert!(ios_source().contains(head), "{head}");
            notify::tests_support::assert_panic_free(head, body(source, head));
        }
        for head in [
            "pub(crate) fn asset_raw(",
            "pub(crate) unsafe fn asset_release(",
            "pub(crate) fn ai_refused(",
            "pub(crate) unsafe fn ai_release(",
            "pub(crate) fn checked_asset(",
        ] {
            notify::tests_support::assert_panic_free(head, top_body(source, head));
        }
        for head in [
            "    pub(crate) fn ai_raw(",
            "    fn ai_payload(",
            "    pub(crate) fn ai(",
            "    pub(crate) fn ai_kind(",
            "    pub(crate) fn asset(",
        ] {
            notify::tests_support::assert_panic_free(head, body(source, head));
        }
        // 長さは入口で 0 にし、0 の長さは無いものとして扱う。解放は同じ長さで作り直す。
        let asset = top_body(source, "pub(crate) fn asset_raw(");
        assert!(asset.contains("if out_len.is_null() {"));
        assert!(asset.contains("unsafe { *out_len = 0 };"));
        assert!(asset.contains("if len == 0 {"));
        assert!(asset.contains("Box::into_raw(boxed).cast::<u8>()"));
        assert!(top_body(source, "pub(crate) unsafe fn asset_release(")
            .contains("Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))"));
        let ai = body(source, "    pub(crate) fn ai_raw(");
        assert!(ai.contains("if out_code.is_null() {"));
        assert!(ai.contains("json.into_raw()"));
        assert!(
            top_body(source, "pub(crate) unsafe fn ai_release(").contains("CString::from_raw(ptr)")
        );
        let payload = body(source, "    fn ai_payload(");
        let len_check = payload.find("check_apple_ai_payload_len(").unwrap();
        let null_check = payload.find("if ptr.is_null() {").unwrap();
        let slice = payload.find("from_raw_parts(").unwrap();
        assert!(len_check < null_check && null_check < slice);
        // 呼び出しの間はロックを持たない（ロックはその前後の塊の中だけ）。
        let ai_body = body(source, "    pub(crate) fn ai(");
        let call = ai_body.find("self.native.ai_extract(").unwrap();
        let before = &ai_body[..call];
        assert_eq!(before.matches("self.locked()").count(), 1);
        let lock_at = before.find("self.locked()").unwrap();
        assert!(before[lock_at..].contains("\n        };\n"));
        // Runner を置いてから Swift へ入口を渡す。
        let install = body(source, "    pub(crate) fn install<R: Runtime>(");
        let set = install.find("RUNNER.set(").unwrap();
        let handed = install.find("aoiko_runner_install(").unwrap();
        assert!(set < handed);
        for (head, first, last) in [
            (
                "extern \"C\" fn on_fetch(",
                "let _ = catch_unwind(AssertUnwindSafe(|| {",
                "}));",
            ),
            (
                "extern \"C\" fn on_complete(",
                "let done = catch_unwind(AssertUnwindSafe(|| {",
                "i32::from(matches!(done, Ok(true)))",
            ),
            (
                "extern \"C\" fn on_expired(",
                "let _ = catch_unwind(AssertUnwindSafe(|| {",
                "}));",
            ),
        ] {
            let lines: Vec<&str> = body(source, head)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect();
            assert_eq!(lines.first(), Some(&first), "{head}");
            assert_eq!(lines.last(), Some(&last), "{head}");
        }
        assert!(body(source, "fn copy_bytes(").contains("if ptr.is_null() {"));
    }

    #[test]
    fn the_runner_paths_swift_reaches_cannot_panic_by_construction() {
        let source = include_str!("runner.rs");
        for head in [
            "    pub(crate) fn fetch(self: &'static Self,",
            "    fn fetched(",
            "    pub(crate) fn complete(",
            "    pub(crate) fn expired(",
            "    fn notify(",
            "    fn locked(",
        ] {
            notify::tests_support::assert_panic_free(head, body(source, head));
        }
    }

    fn swift(name: &str) -> &'static str {
        match name {
            "runner" => include_str!("../ios/Sources/AoikoNativePlugin/AnalysisRunner.swift"),
            "background" => include_str!("../ios/Sources/AoikoNativePlugin/BackgroundTime.swift"),
            "recognition" => include_str!("../ios/Sources/AoikoNativePlugin/TextRecognition.swift"),
            "hold" => include_str!("../ios/Sources/AoikoNativePlugin/RunnerHold.swift"),
            "plugin" => include_str!("../ios/Sources/AoikoNativePlugin/AoikoNativePlugin.swift"),
            _ => include_str!("../ios/Sources/AoikoNativePlugin/AppState.swift"),
        }
    }
    // 宣言を 1 行に詰めて比べる（改行と字下げの違いを除く）。
    fn flat(source: &str, from: &str, to: &str) -> String {
        let start = source.find(from).expect(from);
        let rest = &source[start..];
        let end = rest.find(to).expect(to) + to.len();
        rest[..end]
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .replace("( ", "(")
            .replace(", )", ")")
            .replace(" )", ")")
    }
    // 評価するのは固定の runner.js だけで、仕様と応答は引数として渡す。
    #[test]
    fn the_swift_runner_evaluates_only_the_fixed_script() {
        let source = swift("runner");
        assert_eq!(source.matches("evaluateScript(").count(), 1);
        assert!(source.contains("context.evaluateScript(script)"));
        assert!(source.contains("runner.invokeMethod(\"run\", withArguments: [spec])"));
        assert!(!source.contains("isInspectable"));
        assert!(!source.contains("JSEvaluateScript"));
        assert!(source.contains("JSONSerialization.data(withJSONObject: meta)"));
        // 汎用の呼び出し口は作らない。aoikoHost に置く名前は 10 個だけ。
        assert_eq!(source.matches("forKeyedSubscript: \"").count(), 11);
        assert!(source
            .contains("context.setObject(host, forKeyedSubscript: \"aoikoHost\" as NSString)"));
        for name in [
            "fetch",
            "setTimeout",
            "clearTimeout",
            "progress",
            "appleAiAvailability",
            "appleAiExtract",
            "appleAiRun",
            "recognizeText",
            "decodeImage",
            "assetBuffer",
        ] {
            assert!(
                source.contains(&format!("forKeyedSubscript: \"{name}\" as NSString")),
                "{name}"
            );
        }
        // window は作らない。
        assert!(!source.contains("\"window\""));
        // assetBuffer の名前は 3 つだけで、Rust のアセットは assetBuffer からしか求めない。
        let mapping = source
            .split("func runnerAssetCode(_ name: String) -> UInt32? {")
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap();
        assert_eq!(mapping.matches("case \"").count(), 3);
        for name in [
            "tesseract-core",
            "tesseract-core-fallback",
            "jpn-traineddata",
        ] {
            assert!(mapping.contains(&format!("case \"{name}\":")), "{name}");
        }
        assert_eq!(source.matches("hooks.local.asset(").count(), 1);
        let asset_buffer = source
            .split("private func hostAssetBuffer(")
            .nth(1)
            .and_then(|rest| rest.split("\n    }\n").next())
            .unwrap();
        assert!(asset_buffer.contains("hooks.local.asset(code)"));
        assert_eq!(source.matches("asset(code, &length)").count(), 1);
    }
    // Rust へ渡るのは整数とバイト列だけ。JSValue を持つクロージャを外へ出さない。
    #[test]
    fn swift_hands_rust_only_integers_and_bytes() {
        let source = swift("runner");
        assert!(source.contains("let fetch: @Sendable (UInt64, UInt64, Data) -> Void"));
        assert!(source.contains("let complete: @Sendable (UInt64, Data) -> Void"));
        assert!(source.contains("let progress: @Sendable (UInt64, Int64, Int64) -> Void"));
        assert!(source.contains("var pending: [UInt64: PendingReply] = [:]"));
        // 言語をまたぐ呼び出しの型は検査されないので、両側の宣言を固定する。
        assert!(source.contains(
            "typealias RunnerCompleteCallback = @convention(c) (UInt64, UnsafePointer<UInt8>?, Int) -> Int32"
        ));
        assert!(source.contains(
            "complete(token, raw.bindMemory(to: UInt8.self).baseAddress, raw.count) == 1"
        ));
        assert!(ios_source().contains("complete: extern \"C\" fn(u64, *const u8, usize) -> i32,"));
        assert!(ios_source().contains(
            "extern \"C\" fn on_complete(token: u64, ptr: *const u8, len: usize) -> i32 {"
        ));
        // install の 4 つの関数ポインタと、開始の宣言を両側で固定する。
        for (swift_decl, rust_decl) in [
            (
                "typealias RunnerAssetCallback = @convention(c) (UInt32, UnsafeMutablePointer<Int>?) -> UnsafeMutablePointer<UInt8>?",
                "asset: extern \"C\" fn(u32, *mut usize) -> *mut u8,",
            ),
            (
                "typealias RunnerAssetFreeCallback = @convention(c) (UnsafeMutablePointer<UInt8>?, Int) -> Void",
                "asset_free: extern \"C\" fn(*mut u8, usize),",
            ),
            (
                "typealias RunnerAiCallback = @convention(c) (UInt64, UnsafePointer<UInt8>?, Int, UnsafeMutablePointer<Int32>?) -> UnsafeMutablePointer<CChar>?",
                "ai: extern \"C\" fn(u64, *const u8, usize, *mut i32) -> *mut c_char,",
            ),
            (
                "typealias RunnerAiFreeCallback = @convention(c) (UnsafeMutablePointer<CChar>?) -> Void",
                "ai_free: extern \"C\" fn(*mut c_char),",
            ),
        ] {
            assert!(source.contains(swift_decl), "{swift_decl}");
            assert!(ios_source().contains(rust_decl), "{rust_decl}");
        }
        assert_eq!(
            flat(source, "func aoiko_runner_install(", ") {"),
            "func aoiko_runner_install(_ fetch: @escaping RunnerFetchCallback, _ complete: @escaping RunnerCompleteCallback, _ expired: @escaping RunnerExpiredCallback, _ asset: @escaping RunnerAssetCallback, _ assetFree: @escaping RunnerAssetFreeCallback, _ ai: @escaping RunnerAiCallback, _ aiFree: @escaping RunnerAiFreeCallback) {"
        );
        assert_eq!(
            flat(ios_source(), "fn aoiko_runner_install(", ");"),
            "fn aoiko_runner_install(fetch: extern \"C\" fn(u64, u64, *const u8, usize), complete: extern \"C\" fn(u64, *const u8, usize) -> i32, expired: extern \"C\" fn(u64), asset: extern \"C\" fn(u32, *mut usize) -> *mut u8, asset_free: extern \"C\" fn(*mut u8, usize), ai: extern \"C\" fn(u64, *const u8, usize, *mut i32) -> *mut c_char, ai_free: extern \"C\" fn(*mut c_char));"
        );
        assert!(ios_source()
            .contains("extern \"C\" fn on_asset(code: u32, out_len: *mut usize) -> *mut u8 {"));
        assert!(ios_source().contains("extern \"C\" fn on_asset_free(ptr: *mut u8, len: usize) {"));
        assert!(ios_source().contains("extern \"C\" fn aoiko_runner_ai_free(ptr: *mut c_char) {"));
        assert_eq!(
            flat(source, "@_cdecl(\"aoiko_runner_start\")", "-> Int32"),
            "@_cdecl(\"aoiko_runner_start\") func aoiko_runner_start(_ token: UInt64, _ script: UnsafePointer<UInt8>?, _ scriptLen: Int, _ spec: UnsafePointer<UInt8>?, _ specLen: Int, _ title: UnsafePointer<CChar>?, _ subtitle: UnsafePointer<CChar>?, _ engine: UInt32, _ image: UnsafePointer<UInt8>?, _ imageLen: Int) -> Int32"
        );
        assert_eq!(
            flat(ios_source(), "fn aoiko_runner_start(", ") -> i32;"),
            "fn aoiko_runner_start(token: u64, script: *const u8, script_len: usize, spec: *const u8, spec_len: usize, title: *const c_char, subtitle: *const c_char, engine: u32, image: *const u8, image_len: usize) -> i32;"
        );
        // 0 開始 / 1 断った / 2 web view へ戻す。
        assert!(source.contains("// 0 開始 / 1 未設定・引数が不正 / 2 web view の経路へ戻す"));
        assert_eq!(NATIVE_STARTED, 0);
        assert_eq!(NATIVE_USE_WEBVIEW, 2);
        // 長さは 1 度だけ読み、null でない戻りのすぐ後の defer で同じ値を返して解放する。
        let copy = source
            .split("private func copyAsset(")
            .nth(1)
            .and_then(|rest| rest.split("\n    }\n").next())
            .unwrap();
        let lines: Vec<&str> = copy.lines().map(str::trim).collect();
        let guard_at = lines
            .iter()
            .position(|line| *line == "guard let pointer = asset(code, &length) else {")
            .unwrap();
        assert_eq!(lines.get(guard_at + 3), Some(&"let count = length"));
        assert_eq!(
            lines.get(guard_at + 4),
            Some(&"defer { release(pointer, count) }")
        );
        assert_eq!(copy.matches("length").count(), 3);
        // OS の AI の結果は写してから同じキューの上で解放する。
        let ai = source
            .split("private func callRunnerAi(")
            .nth(1)
            .and_then(|rest| rest.split("\n    }\n").next())
            .unwrap();
        assert!(ai.contains("defer { release(pointer) }"));
        assert!(ai.contains("return .json(String(cString: pointer))"));
    }

    // OS の文字認識は、プラグインのコマンドと解析の実行環境が同じ関数を使う。
    #[test]
    fn the_command_and_the_runner_share_one_text_recognition() {
        assert!(swift("plugin").contains("switch runTextRecognition(on: data) {"));
        assert!(swift("runner").contains("recognize: { image in runTextRecognition(on: image) })"));
        assert!(!swift("plugin").contains("VNImageRequestHandler"));
        let recognition = swift("recognition");
        for banned in ["import UIKit", "import Tauri", "import WebKit"] {
            assert!(!recognition.contains(banned), "{banned}");
        }
        assert!(swift("hold").starts_with("import Foundation\n"));
        assert_eq!(swift("hold").matches("import ").count(), 1);
    }

    #[test]
    fn new_swift_files_never_log() {
        for name in ["runner", "background", "state", "recognition", "hold"] {
            let source = swift(name);
            for banned in [
                "print(",
                "NSLog",
                "os_log",
                "Logger(",
                "debugPrint",
                "dump(",
            ] {
                assert!(!source.contains(banned), "{name}: {banned}");
            }
        }
    }
    // 識別子はジョブごとに作り、登録できたときだけ投げる。plist のワイルドカードと揃える。
    #[test]
    fn the_continued_task_identifier_matches_the_plist_and_registers_once() {
        let source = swift("background");
        assert!(source.contains("let continuedTaskPrefix = \"net.lonshaus.aoiko.ios.analysis.\""));
        assert!(source.contains(
            "if registered && scheduler.submit(identifier, title: title, subtitle: subtitle) {"
        ));
        assert!(source.contains("request.strategy = .fail"));
        assert!(source
            .contains("if scheduler.supportsContinuedProcessing() && scheduler.isAppActive() {"));
        assert_eq!(source.matches("BackgroundTime.makeIdentifier()").count(), 1);
        assert!(source.contains("let expiryNotifyWaitSeconds: TimeInterval = 2"));
        assert!(!source.contains("DispatchQueue.main.sync"));
        let plist = include_str!("../../../Info.ios.plist");
        assert!(plist.contains("<key>BGTaskSchedulerPermittedIdentifiers</key>"));
        assert!(plist.contains("<string>net.lonshaus.aoiko.ios.analysis.*</string>"));
        assert!(!plist.contains("UIBackgroundModes"));
    }

    #[test]
    fn the_spec_types_never_derive_debug_and_the_key_has_no_display() {
        let source = include_str!("runner.rs");
        let head = source.split("#[cfg(test)]").next().unwrap();
        assert!(!head.contains("impl std::fmt::Debug for ApiKey"));
        assert!(!head.contains("impl std::fmt::Display for ApiKey"));
        for name in [
            "struct ApiKey",
            "struct AdapterSpec",
            "struct Spec",
            "struct RawSpec",
            "struct Validated",
        ] {
            let before = head.split(name).next().unwrap();
            let attrs: String = before
                .lines()
                .rev()
                .skip(1)
                .take_while(|line| line.starts_with("#["))
                .collect();
            assert!(!attrs.contains("Debug"), "{name}");
        }
        for banned in [
            "expect(",
            "panic!(",
            "unwrap()",
            "println!",
            "eprintln!",
            "dbg!",
            "log::",
        ] {
            assert!(!head.contains(banned), "{banned}");
        }
    }
}
