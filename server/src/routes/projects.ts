import { ZipArchive } from "archiver";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, paths } from "../config.js";
import { db, getSetting, newId, now, parseJson } from "../db.js";
import { ACCEPTED, createProject, deleteProject, ingestFile, kindFromName } from "../lib/assets.js";
import { HttpError, sendFile } from "../lib/http.js";
import { projectProfile, type ProjectRow } from "../pipeline/context.js";
import { enqueueJob, retryJob, StageError } from "../pipeline/runner.js";
import { STAGES } from "../pipeline/stages.js";
import type { EditPlan } from "../pipeline/types.js";
import { profileSchema } from "../presets.js";

const getProject = (id: string) => {
  const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  if (!p) throw new HttpError(404, "Proyecto no encontrado");
  return p;
};

function assetView(a: Record<string, unknown>) {
  const probe = parseJson<{ format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number }[] } | null>(a.probe as string, null);
  const v = probe?.streams?.find((s) => s.codec_type === "video");
  return {
    id: a.id, kind: a.kind, name: a.original_name, size: a.size, position: a.position, createdAt: a.created_at,
    duration: probe?.format?.duration ? Number(probe.format.duration) : null,
    width: v?.width ?? null, height: v?.height ?? null,
    hasThumb: !!a.thumb, warnings: parseJson<string[]>(a.warnings as string, []), missing: !a.path,
  };
}

function jobView(jobId: string) {
  const j = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as Record<string, string | number | null> | undefined;
  if (!j) return null;
  const stages = db.prepare("SELECT * FROM job_stages WHERE job_id = ? ORDER BY position").all(jobId) as Record<string, string | number | null>[];
  return {
    id: j.id, type: j.type, status: j.status, error: j.error, createdAt: j.created_at, startedAt: j.started_at, finishedAt: j.finished_at, versionId: j.version_id,
    stages: stages.map((s) => {
      const meta = STAGES.find((x) => x.id === s.stage)!;
      return {
        id: s.stage, label: meta.label, what: meta.what, mayUseExternal: meta.external, mayCost: meta.cost,
        status: s.status, message: s.message, provider: s.provider, costUsd: s.cost_usd, costKnown: !!s.cost_known,
        detail: parseJson(s.detail as string, null), startedAt: s.started_at, finishedAt: s.finished_at,
      };
    }),
  };
}

function versionSummary(v: Record<string, unknown>) {
  const qc = parseJson<{ passed: boolean } | null>(v.qc as string, null);
  const plan = parseJson<EditPlan | null>(v.plan as string, null);
  return {
    id: v.id, n: v.n, label: v.label, createdAt: v.created_at, hasVideo: !!v.video_path && fs.existsSync(v.video_path as string), hasCover: !!v.cover_path,
    qcPassed: qc?.passed ?? null, duration: plan ? plan.timeline.reduce((a, t) => a + (t.end - t.start), 0) : null, aiUsed: plan?.ai.used ?? false,
  };
}

const projectOptionsSchema = z.object({ profile: profileSchema.partial().optional() }).partial();

export function registerProjectRoutes(app: FastifyInstance) {
  app.get("/api/projects", async () => {
    const rows = db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as unknown as ProjectRow[];
    return rows.map((p) => {
      const counts = db.prepare("SELECT COUNT(*) AS n FROM assets WHERE project_id = ? AND kind = 'video'").get(p.id) as { n: number };
      const last = db.prepare("SELECT id FROM versions WHERE project_id = ? ORDER BY n DESC LIMIT 1").get(p.id) as { id: string } | undefined;
      const job = db.prepare("SELECT id FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(p.id) as { id: string } | undefined;
      return { id: p.id, name: p.name, status: p.status, error: p.error, profileId: p.profile_id, createdAt: p.created_at, updatedAt: p.updated_at, clips: counts.n, hasThumb: !!p.thumbnail, lastVersionId: last?.id ?? null, accepted: !!p.accepted_version, lastJobId: job?.id ?? null };
    });
  });

  app.post("/api/projects", async (req) => {
    const body = z.object({ name: z.string().max(120).optional(), profileId: z.string().optional(), options: projectOptionsSchema.optional() }).parse(req.body ?? {});
    const profileId = body.profileId ?? getSetting<string>("defaultProfile", "almantec-viral");
    const id = createProject(body.name?.trim() || `Vídeo ${new Date().toLocaleDateString("es-ES")} ${new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`, profileId, body.options ?? {});
    return { id };
  });

  app.get("/api/projects/:id", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const assets = db.prepare("SELECT * FROM assets WHERE project_id = ? ORDER BY position, created_at").all(p.id) as Record<string, unknown>[];
    const versions = db.prepare("SELECT * FROM versions WHERE project_id = ? ORDER BY n DESC").all(p.id) as Record<string, unknown>[];
    const job = db.prepare("SELECT id FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(p.id) as { id: string } | undefined;
    return {
      id: p.id, name: p.name, status: p.status, error: p.error, profileId: p.profile_id, options: parseJson(p.options, {}), acceptedVersion: p.accepted_version,
      createdAt: p.created_at, updatedAt: p.updated_at, effectiveProfile: projectProfile(p),
      assets: assets.map(assetView), versions: versions.map(versionSummary), job: job ? jobView(job.id) : null,
    };
  });

  app.patch("/api/projects/:id", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const body = z.object({ name: z.string().min(1).max(120).optional(), profileId: z.string().optional(), options: projectOptionsSchema.optional() }).parse(req.body ?? {});
    if (body.profileId && !db.prepare("SELECT 1 FROM profiles WHERE id = ?").get(body.profileId)) throw new HttpError(400, "Perfil desconocido");
    db.prepare("UPDATE projects SET name = COALESCE(?, name), profile_id = COALESCE(?, profile_id), options = COALESCE(?, options), updated_at = ? WHERE id = ?").run(
      body.name ?? null, body.profileId ?? null, body.options ? JSON.stringify(body.options) : null, now(), p.id,
    );
    return { ok: true };
  });

  app.delete("/api/projects/:id", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const running = db.prepare("SELECT 1 FROM jobs WHERE project_id = ? AND status = 'running'").get(p.id);
    if (running) throw new HttpError(409, "No se puede borrar mientras se procesa. Espera a que termine.");
    deleteProject(p.id);
    return { ok: true };
  });

  /** Duplica un proyecto: copia la configuración y referencia los mismos originales (sin repetir análisis). */
  app.post("/api/projects/:id/duplicate", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const id = createProject(`${p.name} (copia)`, p.profile_id, parseJson(p.options, {}));
    const assets = db.prepare("SELECT * FROM assets WHERE project_id = ?").all(p.id) as Record<string, string | number | null>[];
    for (const a of assets) {
      if (!a.path || !fs.existsSync(a.path as string)) continue;
      const dir = path.join(paths.project(id), "originales");
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, path.basename(a.path as string));
      fs.linkSync(a.path as string, dest);
      let thumb: string | null = null;
      if (a.thumb && fs.existsSync(a.thumb as string)) {
        thumb = path.join(dir, path.basename(a.thumb as string));
        fs.copyFileSync(a.thumb as string, thumb);
      }
      db.prepare("INSERT INTO assets (id, project_id, kind, original_name, path, size, sha256, probe, thumb, warnings, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        newId("ast"), id, a.kind, a.original_name, dest, a.size, a.sha256, a.probe, thumb, a.warnings, a.position, now(),
      );
    }
    return { id };
  });

  app.post("/api/projects/:id/assets", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const results: { name: string; ok: boolean; id?: string; error?: string }[] = [];
    const tmpDir = path.join(config.dataDir, "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    for await (const part of req.files()) {
      const kind = kindFromName(part.filename);
      if (!kind) {
        part.file.resume();
        results.push({ name: part.filename, ok: false, error: `Formato no admitido. Vídeo: ${ACCEPTED.video.join(", ")}; audio: ${ACCEPTED.audio.join(", ")}; guion: .txt/.md` });
        continue;
      }
      const tmp = path.join(tmpDir, newId("up"));
      await pipeline(part.file, fs.createWriteStream(tmp));
      if (part.file.truncated) {
        fs.rmSync(tmp, { force: true });
        results.push({ name: part.filename, ok: false, error: `Supera el tamaño máximo de ${config.maxUploadMb} MB` });
        continue;
      }
      try {
        const id = await ingestFile(p.id, tmp, part.filename, kind);
        results.push({ name: part.filename, ok: true, id });
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        results.push({ name: part.filename, ok: false, error: (e as Error).message });
      }
    }
    return { results };
  });

  app.delete("/api/assets/:id", async (req) => {
    const a = db.prepare("SELECT * FROM assets WHERE id = ?").get((req.params as { id: string }).id) as { id: string; path: string; thumb: string | null; project_id: string } | undefined;
    if (!a) throw new HttpError(404, "Archivo no encontrado");
    db.prepare("DELETE FROM assets WHERE id = ?").run(a.id);
    // Los proyectos duplicados usan enlaces duros: borrar aquí no afecta a la copia.
    if (a.path) fs.rmSync(a.path, { force: true });
    if (a.thumb) fs.rmSync(a.thumb, { force: true });
    return { ok: true };
  });

  app.post("/api/projects/:id/order", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    const upd = db.prepare("UPDATE assets SET position = ? WHERE id = ? AND project_id = ?");
    ids.forEach((id, i) => upd.run(i, id, p.id));
    return { ok: true };
  });

  app.get("/api/assets/:id/thumb", async (req, reply) => {
    const a = db.prepare("SELECT thumb FROM assets WHERE id = ?").get((req.params as { id: string }).id) as { thumb: string | null } | undefined;
    return sendFile(req, reply, a?.thumb);
  });

  app.get("/api/projects/:id/thumb", async (req, reply) => {
    const p = getProject((req.params as { id: string }).id);
    if (p.thumbnail) return sendFile(req, reply, p.thumbnail);
    const a = db.prepare("SELECT thumb FROM assets WHERE project_id = ? AND thumb IS NOT NULL ORDER BY position LIMIT 1").get(p.id) as { thumb: string } | undefined;
    return sendFile(req, reply, a?.thumb);
  });

  app.post("/api/projects/:id/generate", async (req) => {
    const p = getProject((req.params as { id: string }).id);
    try {
      return { jobId: enqueueJob(p.id, "generate") };
    } catch (e) {
      if (e instanceof StageError) throw new HttpError(409, e.message);
      throw e;
    }
  });

  app.get("/api/jobs/:id", async (req) => {
    const j = jobView((req.params as { id: string }).id);
    if (!j) throw new HttpError(404, "Trabajo no encontrado");
    return j;
  });

  app.post("/api/jobs/:id/retry", async (req) => {
    const id = (req.params as { id: string }).id;
    const j = db.prepare("SELECT status FROM jobs WHERE id = ?").get(id) as { status: string } | undefined;
    if (!j) throw new HttpError(404, "Trabajo no encontrado");
    if (j.status !== "failed" && j.status !== "cancelled") throw new HttpError(409, "Solo se pueden reintentar trabajos fallidos o cancelados");
    retryJob(id);
    return { ok: true };
  });

  app.post("/api/jobs/:id/cancel", async (req) => {
    const id = (req.params as { id: string }).id;
    const r = db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'").run(now(), id);
    if (!r.changes) throw new HttpError(409, "Solo se pueden cancelar trabajos en cola (los que ya están procesando terminan su etapa actual)");
    const j = db.prepare("SELECT project_id FROM jobs WHERE id = ?").get(id) as { project_id: string };
    db.prepare("UPDATE projects SET status = 'draft' WHERE id = ?").run(j.project_id);
    return { ok: true };
  });

  // ------- Versiones -------
  const getVersion = (id: string) => {
    const v = db.prepare("SELECT * FROM versions WHERE id = ?").get(id) as Record<string, string | number | null> | undefined;
    if (!v) throw new HttpError(404, "Versión no encontrada");
    return v;
  };

  app.get("/api/versions/:id", async (req) => {
    const v = getVersion((req.params as { id: string }).id);
    const dir = path.dirname(v.video_path as string ?? v.subtitles_path as string);
    const capFile = path.join(dir, "captions.json");
    const job = db.prepare("SELECT id FROM jobs WHERE version_id = ?").get(v.id) as { id: string } | undefined;
    return {
      ...versionSummary(v), projectId: v.project_id,
      plan: parseJson(v.plan as string, null), pack: parseJson(v.pack as string, null), qc: parseJson(v.qc as string, null),
      captions: fs.existsSync(capFile) ? JSON.parse(fs.readFileSync(capFile, "utf8")) : null,
      stages: job ? jobView(job.id)?.stages : null,
    };
  });

  app.get("/api/versions/:id/video", async (req, reply) => {
    const v = getVersion((req.params as { id: string }).id);
    const q = req.query as { download?: string };
    return sendFile(req, reply, v.video_path as string, q.download ? `almantec_v${v.n}.mp4` : undefined);
  });
  app.get("/api/versions/:id/cover", async (req, reply) => {
    const v = getVersion((req.params as { id: string }).id);
    const q = req.query as { download?: string };
    return sendFile(req, reply, v.cover_path as string, q.download ? `portada_v${v.n}.jpg` : undefined);
  });
  app.get("/api/versions/:id/srt", async (req, reply) => {
    const v = getVersion((req.params as { id: string }).id);
    return sendFile(req, reply, v.subtitles_path as string, `subtitulos_v${v.n}.srt`);
  });

  app.get("/api/versions/:id/package", async (req, reply) => {
    const v = getVersion((req.params as { id: string }).id);
    const plan = parseJson<EditPlan | null>(v.plan as string, null);
    const pack = parseJson<Record<string, unknown> & { titles: string[]; description: string; hashtags: { tag: string; why: string }[]; cta: string; coverText: string; hookSummary: string; source: string } | null>(v.pack as string, null);
    const p = getProject(v.project_id as string);
    const md = [
      `# ${p.name} · versión ${v.n}`,
      "", "## Títulos propuestos", ...(pack?.titles ?? []).map((t, i) => `${i + 1}. ${t}`),
      "", "## Descripción", pack?.description ?? "",
      "", "## Hashtags", ...(pack?.hashtags ?? []).map((h) => `- ${h.tag}: ${h.why}`),
      "", "## Llamada a la acción", pack?.cta ?? "",
      "", "## Frase de portada", pack?.coverText ?? "",
      "", "## Gancho utilizado", pack?.hookSummary ?? "",
      "", "## Cambios realizados", ...(plan?.changes ?? []).map((c) => `- ${c}`),
      "", "## Avisos y limitaciones", ...((plan?.warnings.length ? plan.warnings : ["Ninguno"]).map((w) => `- ${w}`)),
      "", `_Textos generados ${pack?.source === "ia" ? "con IA" : "por plantilla, sin IA"}. Revísalos antes de publicar._`,
    ].join("\n");
    const name = `almantec_${p.name.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40)}_v${v.n}.zip`;
    reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    const zip = new ZipArchive({ zlib: { level: 1 } });
    if (v.video_path && fs.existsSync(v.video_path as string)) zip.file(v.video_path as string, { name: "video.mp4" });
    if (v.cover_path && fs.existsSync(v.cover_path as string)) zip.file(v.cover_path as string, { name: "portada.jpg" });
    if (v.subtitles_path && fs.existsSync(v.subtitles_path as string)) zip.file(v.subtitles_path as string, { name: "subtitulos.srt" });
    zip.append(md, { name: "publicacion.md" });
    zip.append(JSON.stringify(plan, null, 2), { name: "plan_de_edicion.json" });
    void zip.finalize();
    return reply.send(zip);
  });

  const rerenderSchema = z.object({
    overrides: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }).optional(),
    captionEdits: z.record(z.string(), z.string().max(200)).optional(),
    voice: z.enum(["femenina", "masculina"]).optional(),
    voiceoverMode: z.enum(["auto", "ninguna", "siempre"]).optional(),
    subtitleStyle: profileSchema.shape.subtitleStyle.optional(),
    hookText: z.string().max(60).optional(),
  });

  app.post("/api/versions/:id/rerender", async (req) => {
    const v = getVersion((req.params as { id: string }).id);
    const body = rerenderSchema.parse(req.body ?? {});
    try {
      return { jobId: enqueueJob(v.project_id as string, "rerender", { baseVersionId: v.id as string, ...body }) };
    } catch (e) {
      if (e instanceof StageError) throw new HttpError(409, e.message);
      throw e;
    }
  });

  app.post("/api/versions/:id/variation", async (req) => {
    const v = getVersion((req.params as { id: string }).id);
    const { kind } = z.object({ kind: z.enum(["gancho", "ritmo"]) }).parse(req.body ?? {});
    try {
      return { jobId: enqueueJob(v.project_id as string, "variation", { baseVersionId: v.id as string, variation: kind }) };
    } catch (e) {
      if (e instanceof StageError) throw new HttpError(409, e.message);
      throw e;
    }
  });

  app.post("/api/versions/:id/accept", async (req) => {
    const v = getVersion((req.params as { id: string }).id);
    db.prepare("UPDATE projects SET accepted_version = ?, updated_at = ? WHERE id = ?").run(v.id, now(), v.project_id);
    return { ok: true };
  });

  app.delete("/api/versions/:id", async (req) => {
    const v = getVersion((req.params as { id: string }).id);
    const dir = path.dirname((v.video_path ?? v.subtitles_path) as string);
    db.prepare("DELETE FROM versions WHERE id = ?").run(v.id);
    if (dir.includes(paths.projects)) fs.rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  });
}
