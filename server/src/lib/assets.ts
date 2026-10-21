import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { db, newId, now } from "../db.js";
import { ffmpeg, ffprobe, mediaInfo } from "./ffmpeg.js";

export const ACCEPTED = {
  video: [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".3gp", ".mts"],
  audio: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"],
  script: [".txt", ".md"],
  reference: [".jpg", ".jpeg", ".png", ".webp", ".pdf"],
} as const;

export type AssetKind = keyof typeof ACCEPTED;

export function kindFromName(name: string): AssetKind | null {
  const ext = path.extname(name).toLowerCase();
  for (const [k, list] of Object.entries(ACCEPTED)) if ((list as readonly string[]).includes(ext)) return k as AssetKind;
  return null;
}

/** Nombre seguro para el disco (nunca se usa el nombre original como ruta). */
const safeName = (name: string) => path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(-80);

export async function sha256File(file: string) {
  const h = crypto.createHash("sha256");
  await new Promise<void>((res, rej) => fs.createReadStream(file).on("data", (d) => h.update(d)).on("end", () => res()).on("error", rej));
  return h.digest("hex");
}

/**
 * Registra un archivo subido: lo mueve al almacenamiento del proyecto, calcula su huella,
 * valida el contenido real con ffprobe (no basta la extensión) y crea la miniatura.
 */
export async function ingestFile(projectId: string, tmpPath: string, originalName: string, forcedKind?: AssetKind) {
  const kind = forcedKind ?? kindFromName(originalName);
  if (!kind) throw new Error(`Tipo de archivo no admitido: ${path.extname(originalName) || "sin extensión"}`);
  const id = newId("ast");
  const dir = path.join(paths.project(projectId), "originales");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}_${safeName(originalName)}`);
  fs.renameSync(tmpPath, dest);
  const size = fs.statSync(dest).size;
  const warnings: string[] = [];
  let probe: string | null = null;
  let thumb: string | null = null;
  try {
    if (kind === "video" || kind === "audio") {
      const p = await ffprobe(dest);
      const info = mediaInfo(p);
      if (kind === "video" && !info.hasVideo) throw new Error("El archivo no contiene una pista de vídeo válida");
      if (kind === "audio" && !info.hasAudio) throw new Error("El archivo no contiene una pista de audio válida");
      if (info.duration <= 0.3) throw new Error("El archivo está vacío o dura menos de medio segundo");
      probe = JSON.stringify(p);
      if (kind === "video") {
        if (!info.hasAudio) warnings.push("Sin pista de audio");
        if (info.duration > 20 * 60) warnings.push("Grabación muy larga: el análisis tardará más");
        if (Math.min(info.displayWidth, info.displayHeight) < 720) warnings.push(`Resolución baja (${info.displayWidth}×${info.displayHeight})`);
        if (info.fps > 0 && info.fps < 20) warnings.push(`Frecuencia de imagen baja (${info.fps.toFixed(0)} fps)`);
        thumb = path.join(dir, `${id}_thumb.jpg`);
        await ffmpeg(["-ss", Math.min(1, info.duration / 3).toFixed(2), "-i", dest, "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", thumb]);
      }
    } else if (kind === "script") {
      const text = fs.readFileSync(dest, "utf8");
      if (!text.trim()) throw new Error("El guion está vacío");
      if (text.length > 20000) throw new Error("El guion es demasiado largo (máx. 20.000 caracteres)");
    }
  } catch (e) {
    fs.rmSync(dest, { force: true });
    if (thumb) fs.rmSync(thumb, { force: true });
    throw e;
  }
  const sha = await sha256File(dest);
  const dup = db.prepare("SELECT original_name FROM assets WHERE project_id = ? AND sha256 = ?").get(projectId, sha) as { original_name: string } | undefined;
  if (dup) warnings.push(`Idéntico a «${dup.original_name}»: se ignorará al generar`);
  const pos = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM assets WHERE project_id = ?").get(projectId) as { p: number }).p;
  db.prepare("INSERT INTO assets (id, project_id, kind, original_name, path, size, sha256, probe, thumb, warnings, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, projectId, kind, originalName.slice(0, 200), dest, size, sha, probe, thumb, JSON.stringify(warnings), pos, now(),
  );
  db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), projectId);
  return id;
}

export function createProject(name: string, profileId: string | null, options: Record<string, unknown> = {}) {
  const id = newId("prj");
  db.prepare("INSERT INTO projects (id, name, status, profile_id, options, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?)").run(id, name.slice(0, 120), profileId, JSON.stringify(options), now(), now());
  fs.mkdirSync(paths.project(id), { recursive: true });
  return id;
}

export function deleteProject(id: string) {
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  fs.rmSync(paths.project(id), { recursive: true, force: true });
}
