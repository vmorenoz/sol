import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface SqlStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqlDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
  close(): void;
}

type SqlDatabaseConstructor = new (path: string) => SqlDatabase;

const runtimeRequire = createRequire(import.meta.url);
const sqliteModule = runtimeRequire(process.versions["bun"] ? ["bun", "sqlite"].join(":") : ["node", "sqlite"].join(":")) as {
  Database?: SqlDatabaseConstructor;
  DatabaseSync?: SqlDatabaseConstructor;
};
function databaseConstructor(): SqlDatabaseConstructor {
  const constructor = sqliteModule.Database ?? sqliteModule.DatabaseSync;
  if (!constructor) throw new Error("The current runtime does not provide a supported SQLite implementation");
  return constructor;
}
const RuntimeDatabase = databaseConstructor();

export function defaultDatabasePath(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "sol", "sol.db");
}

export class SolDatabase {
  readonly db: SqlDatabase;
  readonly path: string;

  constructor(path = defaultDatabasePath()) {
    this.path = path === ":memory:" ? path : resolve(path);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new RuntimeDatabase(this.path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  close(): void {
    this.db.close();
  }
}
