import fs from "node:fs";
import { config } from "./config.js";
import { db } from "./db.js";

/** Borra originales y renders de proyectos más antiguos que RETENTION_DAYS (si está configurado). */
export function applyRetention() {
  if (!config.retentionDays) return 0;
  const limit = new Date(Date.now() - config.retentionDays * 86400_000).toISOString();
  const assets = db.prepare("SELECT a.id, a.path FROM assets a JOIN projects p ON p.id = a.project_id WHERE p.updated_at < ? AND a.path != ''").all(limit) as { id: string; path: string }[];
  for (const a of assets) {
    fs.rmSync(a.path, { force: true });
    db.prepare("UPDATE assets SET path = '', warnings = json_insert(warnings, '$[#]', 'Original borrado por la política de retención') WHERE id = ?").run(a.id);
  }
  const versions = db.prepare("SELECT v.id, v.video_path FROM versions v JOIN projects p ON p.id = v.project_id WHERE p.updated_at < ? AND v.video_path IS NOT NULL").all(limit) as { id: string; video_path: string }[];
  for (const v of versions) {
    fs.rmSync(v.video_path, { force: true });
    db.prepare("UPDATE versions SET video_path = NULL WHERE id = ?").run(v.id);
  }
  return assets.length + versions.length;
}

export function startRetention() {
  applyRetention();
  setInterval(applyRetention, 6 * 3600_000).unref();
}
