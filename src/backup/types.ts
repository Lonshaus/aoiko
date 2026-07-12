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
  // bytes は呼出元（backup.svelte.ts）が組み立て済みの zip バイナリ。
  // アダプタ側はフォーマットを問わずファイルとして書き込むだけの役割にする。
  backup(bytes: Uint8Array, fileName: string): Promise<{ fileName: string }>;
}
