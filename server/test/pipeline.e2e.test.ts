import { TEST_DATA_DIR, CLIPS } from "./setup.js";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { buildApp } from "../src/index.js";
import { db } from "../src/db.js";
import { ffprobe, mediaInfo } from "../src/lib/ffmpeg.js";
import { tick } from "../src/queue.js";
import { allProviderStatus } from "../src/providers/registry.js";

const clips = ["01_explicacion_horizontal.mp4", "02_proceso_vertical.mp4", "03_resultado_vertical_60fps.mp4"].map((f) => path.join(CLIPS, f));
let base = "";
let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
  if (!clips.every((c) => fs.existsSync(c))) execFileSync("node", ["scripts/make-test-clips.mjs"], { cwd: path.resolve(CLIPS, ".."), stdio: "inherit" });
  app = await buildApp();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
  await app.close();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const json = async (r: Response) => {
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
};
async function upload(projectId: string, files: { name: string; data: Buffer }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("files", new Blob([new Uint8Array(f.data)]), f.name);
  return json(await fetch(`${base}/api/projects/${projectId}/assets`, { method: "POST", body: fd }));
}

test("modelos locales disponibles para la prueba completa", () => {
  const ready = allProviderStatus().filter((p) => !p.external && p.ready).map((p) => p.id);
  assert.ok(ready.includes("silero-vad") && ready.includes("whisper-small-local"), `faltan modelos (npm run models): ${ready}`);
});

test("la subida valida el contenido real y rechaza archivos falsos o no admitidos", async () => {
  const { id } = await json(await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Validación" }) }));
  const r = await upload(id, [
    { name: "falso.mp4", data: Buffer.from("esto no es un vídeo") },
    { name: "programa.exe", data: Buffer.from("MZ") },
    { name: "bueno.mp4", data: fs.readFileSync(clips[2]) },
    { name: "copia.mp4", data: fs.readFileSync(clips[2]) },
  ]);
  assert.equal(r.results[0].ok, false);
  assert.equal(r.results[1].ok, false);
  assert.match(r.results[1].error, /no admitido/);
  assert.equal(r.results[2].ok, true);
  const p = await json(await fetch(`${base}/api/projects/${id}`));
  assert.equal(p.assets.length, 2);
  assert.match(p.assets[1].warnings.join(" "), /Idéntico/);
});

test("flujo completo: subir, generar, controlar calidad, descargar, revisar y reanudar", { timeout: 600_000 }, async () => {
  const { id } = await json(await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Prueba completa" }) }));
  const up = await upload(id, clips.map((c) => ({ name: path.basename(c), data: fs.readFileSync(c) })));
  assert.ok(up.results.every((r: { ok: boolean }) => r.ok));
  const { jobId } = await json(await fetch(`${base}/api/projects/${id}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  await tick();
  const job = await json(await fetch(`${base}/api/jobs/${jobId}`));
  assert.equal(job.status, "done", JSON.stringify(job.stages.filter((s: { status: string }) => s.status === "failed")));
  const v = await json(await fetch(`${base}/api/versions/${job.versionId}`));

  // Archivo final real: H.264 + AAC, 1080×1920, reproducible, con subtítulos y sin silencios largos.
  const vid = db.prepare("SELECT video_path, cover_path FROM versions WHERE id = ?").get(job.versionId) as { video_path: string; cover_path: string };
  const info = mediaInfo(await ffprobe(vid.video_path));
  assert.equal(info.videoCodec, "h264");
  assert.equal(info.audioCodec, "aac");
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1920);
  assert.ok(v.qc.passed, JSON.stringify(v.qc.checks.filter((c: { ok: boolean }) => !c.ok)));
  assert.ok(info.duration < 28, `se ha acortado el material (39,5 s → ${info.duration.toFixed(1)} s)`);
  assert.ok(v.captions.captions.length >= 5, "hay subtítulos");
  assert.ok(v.plan.removed.some((r: { kind: string }) => r.kind === "repeticion"), "detecta la toma repetida");
  assert.ok(fs.existsSync(vid.cover_path));
  assert.equal(v.pack.titles.length, 3);

  // Descargas: vídeo con rangos (reproductor), portada y paquete zip.
  const part = await fetch(`${base}/api/versions/${job.versionId}/video`, { headers: { range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal((await part.arrayBuffer()).byteLength, 100);
  const zip = await fetch(`${base}/api/versions/${job.versionId}/package`);
  assert.equal(zip.status, 200);
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  assert.ok(buf.includes(Buffer.from("publicacion.md")) && buf.includes(Buffer.from("video.mp4")));

  // Revisión: editar un subtítulo y quitar un fragmento; se reutiliza el análisis.
  const cap = v.captions.captions[1];
  const key = cap.words.map((w: { w: string }) => w.w).join(" ");
  const drop = v.plan.units.find((u: { include: boolean; id: string }) => u.include && u.id !== v.plan.hook?.unitId && v.plan.timeline.length > 2);
  const rr = await json(await fetch(`${base}/api/versions/${job.versionId}/rerender`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ captionEdits: { [key]: "Texto corregido a mano" }, overrides: { include: [], exclude: [drop.id] } }) }));
  const t0 = Date.now();
  await tick();
  const job2 = await json(await fetch(`${base}/api/jobs/${rr.jobId}`));
  assert.equal(job2.status, "done");
  const v2 = await json(await fetch(`${base}/api/versions/${job2.versionId}`));
  assert.ok(v2.captions.captions.some((c: { text?: string }) => c.text === "Texto corregido a mano"));
  assert.ok(!v2.plan.timeline.some((t: { unitId: string }) => t.unitId === drop.id));
  assert.ok(job2.stages.find((s: { id: string }) => s.id === "transcripcion").message.includes("reutilizados"), "no vuelve a transcribir");
  assert.ok(Date.now() - t0 < 60_000);

  // Reanudación: se simula una caída tras el plan; al reintentar no se repiten las etapas hechas.
  db.prepare("UPDATE job_stages SET status = 'pending' WHERE job_id = ? AND position >= 5").run(rr.jobId);
  db.prepare("UPDATE job_stages SET status = 'failed' WHERE job_id = ? AND stage = 'voz'").run(rr.jobId);
  db.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(rr.jobId);
  const planBefore = db.prepare("SELECT finished_at FROM job_stages WHERE job_id = ? AND stage = 'plan'").get(rr.jobId) as { finished_at: string };
  await json(await fetch(`${base}/api/jobs/${rr.jobId}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  await tick();
  const job3 = await json(await fetch(`${base}/api/jobs/${rr.jobId}`));
  assert.equal(job3.status, "done");
  const planAfter = db.prepare("SELECT finished_at FROM job_stages WHERE job_id = ? AND stage = 'plan'").get(rr.jobId) as { finished_at: string };
  assert.equal(planAfter.finished_at, planBefore.finished_at, "el plan no se rehízo");

  // Variación de gancho y borrado del proyecto con sus archivos.
  const vr = await json(await fetch(`${base}/api/versions/${job.versionId}/variation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "ritmo" }) }));
  await tick();
  assert.equal((await json(await fetch(`${base}/api/jobs/${vr.jobId}`))).status, "done");
  await json(await fetch(`${base}/api/projects/${id}`, { method: "DELETE" }));
  assert.equal(fs.existsSync(path.dirname(vid.video_path)), false);
});
