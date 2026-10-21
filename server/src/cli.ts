// Uso: tsx src/cli.ts generar <clip1> [clip2 ...] [--perfil id] [--guion archivo.txt] [--musica archivo.mp3]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createProject, ingestFile } from "./lib/assets.js";
import { db } from "./db.js";
import { enqueueJob } from "./pipeline/runner.js";
import { seedProfiles } from "./presets.js";
import { tick } from "./queue.js";

const [cmd, ...rest] = process.argv.slice(2);
if (cmd !== "generar") {
  console.log("Uso: tsx src/cli.ts generar <clips...> [--perfil id] [--guion f.txt] [--musica f.mp3]");
  process.exit(1);
}
seedProfiles();
const flags: Record<string, string> = {};
const files: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else files.push(rest[i]);
}
const pid = createProject(`CLI ${new Date().toLocaleString("es-ES")}`, flags.perfil ?? "almantec-viral");
const copy = async (f: string, kind?: "script" | "audio") => {
  const tmp = path.join(os.tmpdir(), `cli_${Date.now()}_${path.basename(f)}`);
  fs.copyFileSync(f, tmp);
  await ingestFile(pid, tmp, path.basename(f), kind);
};
for (const f of files) await copy(f);
if (flags.guion) await copy(flags.guion, "script");
if (flags.musica) await copy(flags.musica, "audio");
const jobId = enqueueJob(pid, "generate");
const t0 = Date.now();
await tick();
const stages = db.prepare("SELECT stage, status, message, provider, cost_usd, started_at, finished_at FROM job_stages WHERE job_id = ? ORDER BY position").all(jobId) as Record<string, string>[];
for (const s of stages) console.log(`${s.status.padEnd(8)} ${s.stage.padEnd(16)} ${s.message ?? ""}`);
const job = db.prepare("SELECT status, error, version_id FROM jobs WHERE id = ?").get(jobId) as { status: string; error: string; version_id: string };
console.log(`\nTrabajo ${job.status} en ${((Date.now() - t0) / 1000).toFixed(1)} s`, job.error ?? "");
if (job.version_id) {
  const v = db.prepare("SELECT video_path, cover_path, plan, pack, qc FROM versions WHERE id = ?").get(job.version_id) as Record<string, string>;
  console.log("Vídeo:", v.video_path, "\nPortada:", v.cover_path);
  console.log(JSON.stringify({ projectId: pid, versionId: job.version_id }));
}
