import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { paths, ensureDirs } from "./config.js";

ensureDirs();

export const db = new DatabaseSync(paths.db);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

const MIGRATIONS: string[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE profiles (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     builtin INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
     profile_id TEXT, options TEXT NOT NULL DEFAULT '{}', objective TEXT,
     thumbnail TEXT, error TEXT, accepted_version TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE assets (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, original_name TEXT NOT NULL, path TEXT NOT NULL, size INTEGER NOT NULL,
     sha256 TEXT NOT NULL, probe TEXT, thumb TEXT, warnings TEXT NOT NULL DEFAULT '[]',
     position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     type TEXT NOT NULL, status TEXT NOT NULL, options TEXT NOT NULL DEFAULT '{}',
     current_stage TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, version_id TEXT,
     created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
   CREATE TABLE job_stages (
     job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, stage TEXT NOT NULL,
     position INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', message TEXT,
     provider TEXT, cost_usd REAL, cost_known INTEGER NOT NULL DEFAULT 1, detail TEXT,
     started_at TEXT, finished_at TEXT, PRIMARY KEY (job_id, stage));
   CREATE TABLE versions (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     n INTEGER NOT NULL, label TEXT, plan TEXT NOT NULL, video_path TEXT, cover_path TEXT,
     subtitles_path TEXT, pack TEXT, qc TEXT, created_at TEXT NOT NULL);
   CREATE TABLE analysis_cache (key TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE usage (
     id TEXT PRIMARY KEY, at TEXT NOT NULL, provider TEXT NOT NULL, operation TEXT NOT NULL,
     units REAL NOT NULL, unit_type TEXT NOT NULL, cost_usd REAL, project_id TEXT);
   CREATE TABLE refs (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, url TEXT, platform TEXT, title TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '', manual TEXT NOT NULL DEFAULT '{}', analysis TEXT,
     asset_path TEXT, created_at TEXT NOT NULL);
   CREATE TABLE hooks (
     id TEXT PRIMARY KEY, text TEXT NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual',
     notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
   CREATE TABLE ideas (id TEXT PRIMARY KEY, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pendiente', created_at TEXT NOT NULL);
   CREATE TABLE metrics (
     id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, version_id TEXT,
     platform TEXT NOT NULL, posted_at TEXT, data TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);`,
];

function migrate() {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
  const row = db.prepare("SELECT v FROM schema_version").get() as { v: number } | undefined;
  let v = row?.v ?? 0;
  if (!row) db.prepare("INSERT INTO schema_version (v) VALUES (0)").run();
  while (v < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      v++;
      db.prepare("UPDATE schema_version SET v = ?").run(v);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
migrate();

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString("hex")}`;

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? parseJson<T>(row.value, fallback) : fallback;
}

export function setSetting(key: string, value: unknown) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}

export function cacheGet<T>(key: string): T | undefined {
  const row = db.prepare("SELECT data FROM analysis_cache WHERE key = ?").get(key) as { data: string } | undefined;
  return row ? parseJson<T | undefined>(row.data, undefined) : undefined;
}

export function cacheSet(key: string, kind: string, data: unknown) {
  db.prepare(
    "INSERT INTO analysis_cache (key, kind, data, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data",
  ).run(key, kind, JSON.stringify(data), now());
}
