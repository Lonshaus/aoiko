import type { OcrLayout } from '../domain/receipt-text-extract';
// ネイティブのシェルが起動時に注入する橋渡し。
// ブラウザで開いたときは存在しないので、呼ぶ前に必ず関数の有無を見る。橋渡しの実装は
// シェル側が持ち、こちらは SDK を import しない。
//
// 能力ごとに optional にしてあるのは、シェル側の実装が段階的に増えるため。オブジェクトが
// あることと、目的の関数があることは別に確かめる。
export type NativeDiscardText = {
  closeMessage: string;
  closeOk: string;
  reloadMessage: string;
  reloadOk: string;
  cancel: string;
};

export type NativeBridge = {
  // 保存ダイアログを出してファイルを書く。false は利用者が取り消したことを表す。
  saveFile?(
    data: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
    filename: string,
  ): Promise<boolean>;
  // ネイティブのメニューへ今の表示言語を渡す。メニューは WebView の外にあり、
  // こちらのメッセージカタログを読めないため、シェル側が別の辞書を持っている。
  setUiLocale?(locale: string): Promise<void>;
  // 未保存の破棄確認はネイティブのダイアログで出る。シェル側の初期化スクリプトは
  // こちらのメッセージカタログを読めないので、訳した文言を渡す。渡すまでは日本語で出る。
  setDiscardText?(text: NativeDiscardText): void;
  // ストアで売っている品目。価格を自前で組み立てないのは、配信先が 175 地域あって
  // 通貨も表記も地域ごとに違うため。ストアが返した文字列をそのまま出す。
  // 品目 ID はこちら側では決められない（シェル側が環境に合わせて持つ）ので、kind でしか呼ばない。
  listIapProducts?(): Promise<IapProduct[]>;
  // 購入。'pending' は「家族の承認待ち」等、その場で確定しない状態。
  purchaseIap?(kind: IapProductKind): Promise<IapPurchaseResult>;
  // 機種変更・再インストール後に、購入済みの非消耗型を取り戻す。
  // 戻り値は復元できた品目。消耗型（スタンプ）は対象外。
  restoreIapPurchases?(): Promise<IapProductKind[]>;
  // OS 内蔵の文字認識。行に加えて 1 単語ごとの座標・自信度・次の候補まで返す。
  // 構造化は receipt-text-extract が行う。読めなければ拒否する。
  recognizeText?(base64: string): Promise<OcrLayout>;
  // この端末が日本語を読めるか。関数が在ることと読めることは別で、対応言語は
  // OS の版や導入内容で変わる。
  isTextRecognitionAvailable?(): Promise<boolean>;
  // 撮影の入口を出してよいか。備えていない環境では生えない。
  isCameraAvailable?(): Promise<boolean>;
  // OS 内蔵の AI が使えるか。0..5 の意味はネイティブ側のコメントに揃える
  // （0 が「使える」）。
  appleAiAvailability?(): Promise<number>;
  // OS 内蔵の AI でレシートを構造化 JSON にして返す。
  // 失敗時は数値の理由コードで reject する（1 コンテキスト超過 / 2 文字が読めない / 3 その他 / 4 OS が古い）。
  appleAiExtract?(base64: string): Promise<string>;
  // OS 内蔵の AI で分類・注文取込を行う。task は 1 = 分類 / 2 = 注文、data は JSON 文字列。
  // 指示は環境側に固定で埋め込まれており、data はプロンプトではなく処理対象のデータ。
  // 失敗時は数値の理由コードで reject する（1 コンテキスト超過 / 2 入力データが処理できない /
  // 3 その他 / 4 OS が古い）。権限不足・未知コマンド等は数値ではなく文字列で reject される。
  appleAiRun?(task: number, data: string): Promise<string>;
};

export type IapProductKind = 'tip' | 'supporter-badge';

export type IapProduct = {
  kind: IapProductKind;
  // ストアが返す表示用の価格文字列（現地通貨・現地表記）。
  displayPrice: string;
};

export type IapPurchaseResult = 'purchased' | 'cancelled' | 'pending';

export function nativeBridge(): NativeBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return (window as unknown as { __aoikoNative?: NativeBridge }).__aoikoNative ?? null;
}
