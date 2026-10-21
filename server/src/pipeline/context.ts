import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { db, parseJson } from "../db.js";
import { mediaInfo, type MediaInfo, type ProbeResult } from "../lib/ffmpeg.js";
import { defaultProfile, profileSchema, type EditProfile } from "../presets.js";

export interface AssetRow {
  id: string;
  project_id: string;
  kind: string;
  original_name: string;
  path: string;
  size: number;
  sha256: string;
  probe: string | null;
  thumb: string | null;
  warnings: string;
  position: number;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  profile_id: string | null;
  options: string;
  objective: string | null;
  thumbnail: string | null;
  error: string | null;
  accepted_version: string | null;
  created_at: string;
  updated_at: string;
}

export function projectAssets(projectId: string, kind?: string): AssetRow[] {
  const rows = db.prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY position, created_at").all(projectId) as unknown as AssetRow[];
  return kind ? rows.filter((r) => r.kind === kind) : rows;
}

export function assetInfo(a: AssetRow): MediaInfo | null {
  const p = parseJson<ProbeResult | null>(a.probe, null);
  return p ? mediaInfo(p) : null;
}

/** Perfil efectivo del proyecto: perfil guardado + ajustes propios del proyecto. */
export function projectProfile(p: ProjectRow): EditProfile {
  const opts = parseJson<{ profile?: Partial<EditProfile> }>(p.options, {});
  let base: EditProfile = defaultProfile();
  if (p.profile_id) {
    const row = db.prepare("SELECT data FROM profiles WHERE id = ?").get(p.profile_id) as { data: string } | undefined;
    if (row) base = profileSchema.parse(parseJson(row.data, {}));
  }
  return profileSchema.parse({ ...base, ...(opts.profile ?? {}) });
}

export function jobDir(projectId: string, jobId: string) {
  const d = path.join(paths.project(projectId), "jobs", jobId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function versionDir(projectId: string, n: number) {
  const d = path.join(paths.project(projectId), `v${n}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
