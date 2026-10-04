// 端末内の Gemini Nano へ渡す前後の組み立て。モデルを呼ぶのはネイティブ側で、ここは
// 分割・選択・結合だけを持つ（ネイティブ側に単体テストの場が無いため）。
use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
/// 分類を 1 回の推論へ渡す件数。実測で完全性と正答率がいちばん良かった大きさ。
pub(crate) const CLASSIFY_CHUNK: usize = 24;
pub(crate) const RECEIPT_USER_TEXT: &str = "このレシートを読み取ってください。";
/// 端末内モデルを載せていない環境の拒否コード。
#[cfg(not(target_os = "android"))]
pub(crate) const UNSUPPORTED: &str = "unsupported";
// これらはどのチャンクで起きても残りを流す意味が無い。呼び出し全体を同じ理由で断る。
const WHOLE_CALL_CODES: [&str; 4] = ["background", "quota", "unavailable", "too-long"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClassifyData {
    known_account_code: String,
    known_side: String,
    candidates: Vec<Candidate>,
    transactions: Vec<Transaction>,
}

#[derive(Deserialize, Serialize)]
struct Candidate {
    code: String,
    name: String,
}
// フィールドの順序がそのまま推論への入力の並びになる。
#[derive(Deserialize, Serialize)]
struct Transaction {
    #[serde(rename = "ref")]
    reference: String,
    description: String,
    amount: String,
}

#[derive(Serialize)]
struct ChunkInput<'a> {
    candidates: &'a [Candidate],
    transactions: &'a [Transaction],
}

#[derive(Deserialize)]
struct OrderData {
    text: String,
}
/// 既知の科目と借方・貸方の別から指示を選ぶ。測っていない組み合わせには推論させない。
fn classify_prompt(known_account_code: &str, known_side: &str) -> Option<&'static str> {
    match (known_account_code, known_side) {
        ("1130", "credit") => Some("classify-a"),
        ("1130", "debit") => Some("classify-b"),
        ("2120", "credit") => Some("classify-c"),
        ("2120", "debit") => Some("classify-d"),
        _ => None,
    }
}

fn chunk_text(candidates: &[Candidate], transactions: &[Transaction]) -> String {
    serde_json::to_string(&ChunkInput {
        candidates,
        transactions,
    })
    .expect("文字列だけの構造体は必ず直列化できる")
}
/// 応答を囲む ```json フェンスを外す。囲まれていなければそのまま返す。
pub(crate) fn strip_fence(reply: &str) -> &str {
    let trimmed = reply.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let body = match rest.find('\n') {
        Some(newline) => &rest[newline + 1..],
        None => return trimmed,
    };
    match body.rfind("```") {
        Some(end) => body[..end].trim(),
        None => body.trim(),
    }
}
// 1 チャンクぶんの結果。失敗したチャンクの ref は failed として返し、候補の自動入力を必ず塞ぐ。
fn chunk_entries(refs: &[String], outcome: Result<String, String>) -> Result<Vec<Value>, String> {
    let failed = || -> Vec<Value> {
        refs.iter()
            .map(|r| serde_json::json!({ "ref": r, "status": "failed" }))
            .collect()
    };
    let reply = match outcome {
        Ok(reply) => reply,
        Err(code) if WHOLE_CALL_CODES.contains(&code.as_str()) => return Err(code),
        Err(_) => return Ok(failed()),
    };
    let Ok(parsed) = serde_json::from_str::<Value>(strip_fence(&reply)) else {
        return Ok(failed());
    };
    let Some(list) = parsed.get("classifications").and_then(Value::as_array) else {
        return Ok(failed());
    };
    let expected: HashSet<&str> = refs.iter().map(String::as_str).collect();
    // 重複はそのまま渡す。どれを採るかは受け取る側（parseResponse）が決める。
    Ok(list
        .iter()
        .filter(|item| {
            item.get("ref")
                .and_then(Value::as_str)
                .is_some_and(|r| expected.contains(r))
        })
        .cloned()
        .collect())
}
/// task を組み立てて推論を回す。generate は (promptId, text) を受けて応答か拒否コードを返す。
pub(crate) fn run_task(
    task: &str,
    data: &str,
    mut generate: impl FnMut(&str, &str) -> Result<String, String>,
) -> Result<String, String> {
    match task {
        "classify" => {
            let data: ClassifyData =
                serde_json::from_str(data).map_err(|_| "bad-input".to_string())?;
            let prompt = classify_prompt(&data.known_account_code, &data.known_side)
                .ok_or_else(|| "unsupported-account".to_string())?;
            let mut entries = Vec::new();
            for chunk in data.transactions.chunks(CLASSIFY_CHUNK) {
                let refs: Vec<String> = chunk.iter().map(|t| t.reference.clone()).collect();
                let outcome = generate(prompt, &chunk_text(&data.candidates, chunk));
                entries.extend(chunk_entries(&refs, outcome)?);
            }
            Ok(serde_json::json!({ "classifications": entries }).to_string())
        }
        "order" => {
            let data: OrderData =
                serde_json::from_str(data).map_err(|_| "bad-input".to_string())?;
            let reply = generate("order", &data.text)?;
            Ok(strip_fence(&reply).to_string())
        }
        _ => Err("bad-input".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn classify_data(code: &str, side: &str, count: usize) -> String {
        let transactions: Vec<Value> = (0..count)
            .map(|i| {
                serde_json::json!({
                    "ref": format!("r{i}"),
                    "description": format!("摘要{i}"),
                    "amount": "100",
                })
            })
            .collect();
        serde_json::json!({
            "knownAccountCode": code,
            "knownSide": side,
            "candidates": [{ "code": "5120", "name": "荷造運賃", "category": "expense" }],
            "transactions": transactions,
        })
        .to_string()
    }
    // 各 ref に同じ科目を答える応答を、受け取った入力から作る。
    fn answer_all(text: &str) -> String {
        let input: Value = serde_json::from_str(text).unwrap();
        let list: Vec<Value> = input["transactions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| serde_json::json!({ "ref": t["ref"], "accountCode": "5120", "confidence": "high" }))
            .collect();
        format!(
            "```json\n{}\n```",
            serde_json::json!({ "classifications": list })
        )
    }

    fn classifications(result: &str) -> Vec<Value> {
        let parsed: Value = serde_json::from_str(result).unwrap();
        parsed["classifications"].as_array().unwrap().clone()
    }

    #[test]
    fn picks_the_measured_prompt_for_each_known_account_and_side() {
        assert_eq!(classify_prompt("1130", "credit"), Some("classify-a"));
        assert_eq!(classify_prompt("1130", "debit"), Some("classify-b"));
        assert_eq!(classify_prompt("2120", "credit"), Some("classify-c"));
        assert_eq!(classify_prompt("2120", "debit"), Some("classify-d"));
        assert_eq!(classify_prompt("1110", "credit"), None);
        assert_eq!(classify_prompt("2120", "other"), None);
    }

    #[test]
    fn an_unmeasured_known_account_is_refused_without_calling_the_model() {
        let mut calls = 0;
        let result = run_task("classify", &classify_data("1110", "credit", 3), |_, _| {
            calls += 1;
            Ok(String::new())
        });
        assert_eq!(result, Err("unsupported-account".to_string()));
        assert_eq!(calls, 0);
    }

    #[test]
    fn splits_transactions_into_chunks_of_24_in_input_order() {
        for (count, expected_calls) in [(0, 0), (1, 1), (24, 1), (25, 2), (48, 2)] {
            let mut sizes = Vec::new();
            let result = run_task(
                "classify",
                &classify_data("2120", "credit", count),
                |_, text| {
                    let input: Value = serde_json::from_str(text).unwrap();
                    sizes.push(input["transactions"].as_array().unwrap().len());
                    Ok(answer_all(text))
                },
            )
            .unwrap();
            assert_eq!(sizes.len(), expected_calls, "count {count}");
            assert!(sizes.iter().all(|&n| n <= CLASSIFY_CHUNK));
            let refs: Vec<String> = classifications(&result)
                .iter()
                .map(|c| c["ref"].as_str().unwrap().to_string())
                .collect();
            let expected: Vec<String> = (0..count).map(|i| format!("r{i}")).collect();
            assert_eq!(refs, expected, "count {count}");
        }
    }
    // 実測で使った入力と 1 バイトも違わないこと。キーの順序と空白の有無も含む。
    #[test]
    fn chunk_text_matches_the_measured_input_format() {
        let mut texts = Vec::new();
        run_task(
            "classify",
            &classify_data("1130", "debit", 1),
            |prompt, text| {
                assert_eq!(prompt, "classify-b");
                texts.push(text.to_string());
                Ok(answer_all(text))
            },
        )
        .unwrap();
        assert_eq!(
            texts,
            vec![
                r#"{"candidates":[{"code":"5120","name":"荷造運賃"}],"transactions":[{"ref":"r0","description":"摘要0","amount":"100"}]}"#
            ]
        );
    }

    #[test]
    fn strips_a_surrounding_fence() {
        assert_eq!(strip_fence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_fence("```\n{\"a\":1}\n```\n"), "{\"a\":1}");
        assert_eq!(strip_fence("  {\"a\":1}  "), "{\"a\":1}");
        assert_eq!(
            strip_fence("```json\n{\"a\":1}\n```\n以上です"),
            "{\"a\":1}"
        );
        assert_eq!(strip_fence("```json {\"a\":1}"), "```json {\"a\":1}");
    }

    #[test]
    fn a_chunk_with_invalid_json_marks_only_its_refs_failed() {
        let mut call = 0;
        let result = run_task(
            "classify",
            &classify_data("2120", "credit", 25),
            |_, text| {
                call += 1;
                if call == 1 {
                    Ok("```json\n{\"classifications\":[{\"ref\":\"r0\"\n```".to_string())
                } else {
                    Ok(answer_all(text))
                }
            },
        )
        .unwrap();
        let list = classifications(&result);
        assert_eq!(list.len(), 25);
        assert!(list[..24].iter().all(|c| c["status"] == "failed"));
        assert_eq!(list[24]["ref"], "r24");
        assert_eq!(list[24]["accountCode"], "5120");
    }

    #[test]
    fn a_reply_without_a_classifications_array_marks_the_chunk_failed() {
        let result = run_task("classify", &classify_data("2120", "credit", 2), |_, _| {
            Ok("{\"answers\":[]}".to_string())
        })
        .unwrap();
        assert!(classifications(&result)
            .iter()
            .all(|c| c["status"] == "failed"));
    }

    #[test]
    fn missing_refs_stay_missing_and_extra_refs_are_dropped() {
        let result = run_task("classify", &classify_data("2120", "credit", 3), |_, _| {
            Ok(r#"{"classifications":[{"ref":"r0","accountCode":"5120","confidence":"high"},{"ref":"zz","accountCode":"5120","confidence":"high"}]}"#.to_string())
        })
        .unwrap();
        let list = classifications(&result);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0]["ref"], "r0");
    }

    #[test]
    fn duplicate_refs_pass_through_for_the_receiver_to_decide() {
        let result = run_task("classify", &classify_data("2120", "credit", 1), |_, _| {
            Ok(r#"{"classifications":[{"ref":"r0","accountCode":"5120","confidence":"low"},{"ref":"r0","accountCode":"5160","confidence":"high"}]}"#.to_string())
        })
        .unwrap();
        let list = classifications(&result);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0]["accountCode"], "5120");
        assert_eq!(list[1]["accountCode"], "5160");
    }

    #[test]
    fn busy_or_failed_chunks_are_marked_failed_and_the_rest_continues() {
        for code in ["busy", "failed"] {
            let mut call = 0;
            let result = run_task(
                "classify",
                &classify_data("1130", "credit", 30),
                |_, text| {
                    call += 1;
                    if call == 1 {
                        Err(code.to_string())
                    } else {
                        Ok(answer_all(text))
                    }
                },
            )
            .unwrap();
            let list = classifications(&result);
            assert_eq!(list.len(), 30);
            assert!(list[..24].iter().all(|c| c["status"] == "failed"));
            assert!(list[24..].iter().all(|c| c["accountCode"] == "5120"));
        }
    }

    #[test]
    fn whole_call_codes_reject_the_call_even_after_a_successful_chunk() {
        for code in WHOLE_CALL_CODES {
            let mut call = 0;
            let result = run_task(
                "classify",
                &classify_data("1130", "credit", 30),
                |_, text| {
                    call += 1;
                    if call == 1 {
                        Ok(answer_all(text))
                    } else {
                        Err(code.to_string())
                    }
                },
            );
            assert_eq!(result, Err(code.to_string()));
        }
    }

    #[test]
    fn order_passes_the_pasted_text_and_strips_the_fence() {
        let mut seen = Vec::new();
        let result = run_task(
            "order",
            r#"{"text":"注文の詳細\n合計"}"#,
            |prompt, text| {
                seen.push((prompt.to_string(), text.to_string()));
                Ok("```json\n{\"totalAmount\":\"100\"}\n```".to_string())
            },
        );
        assert_eq!(result, Ok("{\"totalAmount\":\"100\"}".to_string()));
        assert_eq!(
            seen,
            vec![("order".to_string(), "注文の詳細\n合計".to_string())]
        );
    }

    #[test]
    fn order_rejections_pass_through() {
        let result = run_task("order", r#"{"text":"x"}"#, |_, _| {
            Err("too-long".to_string())
        });
        assert_eq!(result, Err("too-long".to_string()));
    }

    #[test]
    fn malformed_data_and_unknown_tasks_are_bad_input() {
        let never =
            |_: &str, _: &str| -> Result<String, String> { panic!("model must not be called") };
        assert_eq!(
            run_task("classify", "{", never),
            Err("bad-input".to_string())
        );
        assert_eq!(run_task("order", "{}", never), Err("bad-input".to_string()));
        assert_eq!(
            run_task("summarize", "{}", never),
            Err("bad-input".to_string())
        );
    }
}
