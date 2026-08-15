interface FflateRuntime {
  unzipSync(data: Uint8Array): Record<string, Uint8Array>;
  zipSync(files: Record<string, Uint8Array>, options?: { level?: number }): Uint8Array;
  strToU8(value: string): Uint8Array;
  strFromU8(value: Uint8Array): string;
}

interface FzstdRuntime {
  decompress(data: Uint8Array): Uint8Array;
}

interface SqlStatement {
  bind(values?: unknown[] | Record<string, unknown>): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): boolean;
}

interface SqlDatabase {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  run(sql: string, params?: unknown[]): SqlDatabase;
  prepare(sql: string): SqlStatement;
  export(): Uint8Array;
  close(): void;
}

interface SqlJsRuntime {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

declare const fflate: FflateRuntime;
declare const fzstd: FzstdRuntime;
declare function initSqlJs(options?: { locateFile?: (file: string) => string }): Promise<SqlJsRuntime>;
