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
  backup(payload: BackupPayload): Promise<{ fileName: string }>;
}