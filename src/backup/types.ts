export interface BackupPayload {
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export interface BackupAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  isReady(): Promise<boolean>;
  ensurePermission(): Promise<boolean>;
  configure(): Promise<void>;
  // stream は呼出元（backup.svelte.ts）が組み立て済みの zip をストリームで渡す。
  // アダプタ側はフォーマットを問わずファイルとして書き込むだけの役割にする。
  // path に '/' を含めた場合、途中のディレクトリは実装側が作る。
  backup(stream: ReadableStream<Uint8Array>, path: string): Promise<{ fileName: string }>;
  // 保存先にある既存バックアップのファイル名一覧（古いものの汰換判定に使う）。
  // ディレクトリは含まない。subdir を渡すとその直下だけを返す。返すのはパスではなく名前。
  // 存在しないディレクトリは空配列。同期途中のフォルダでは普通に起きるため。
  list(subdir?: string): Promise<string[]>;
  // 指定パスの中身を読む。見つからなければ null。
  //
  // 例外にしないのは、内容定址バックアップでは「欠けている」が異常ではなく通常の
  // 分岐だから。同期が半分だけ進んだ状態で新しいスナップショットが参照する blob が
  // まだ無い、というのが想定内で、その場合は 1 つ前のスナップショットへ落とす。
  // 権限拒否や IO 失敗は従来どおり例外。
  read(path: string): Promise<Uint8Array | null>;
  // 指定パスのファイルを削除する
  remove(path: string): Promise<void>;
}
