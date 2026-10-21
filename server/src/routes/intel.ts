import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config, paths } from "../config.js";
import { db, newId, now, parseJson } from "../db.js";
import { sha256File } from "../lib/assets.js";
import { checkBudget, recordUsage } from "../lib/costs.js";
import { ffprobe, mediaInfo } from "../lib/ffmpeg.js";
import { HttpError } from "../lib/http.js";
import { analyzeAudio, analyzeVisual, extractWav } from "../pipeline/analyze.js";
import type { EditPlan } from "../pipeline/types.js";
import { anthropicJson, anthropicStatus, estimateAnthropicCost } from "../providers/anthropic.js";
import { transcriberFor } from "../providers/registry.js";

const PLATFORMS = ["instagram", "tiktok", "youtube", "otra"] as const;

const SEED_HOOKS: { text: string; type: string }[] = [
  { text: "Mira cómo queda al final", type: "resultado" },
  { text: "Antes y después de esta reparación", type: "antes_despues" },
  { text: "¿Se puede salvar este móvil?", type: "pregunta" },
  { text: "Llegó así al taller… y así se va", type: "transformacion" },
  { text: "El error más común con [componente]", type: "error_habitual" },
  { text: "Esta avería parecía imposible", type: "reparacion_complicada" },
  { text: "Original vs. compatible: la diferencia", type: "comparacion" },
];

export function seedHooks() {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM hooks").get() as { n: number }).n;
  if (n) return;
  const ins = db.prepare("INSERT INTO hooks (id, text, type, source, notes, created_at) VALUES (?, ?, ?, 'plantilla', 'Estructura de gancho genérica: adáptala solo si el vídeo lo respalda', ?)");
  for (const h of SEED_HOOKS) ins.run(newId("hk"), h.text, h.type, now());
}

const refAiSchema = z.object({
  hookType: z.string(), structure: z.string(), editingPace: z.string(), subtitleStyle: z.string(), voiceover: z.string(),
  shotTypes: z.string(), soundAndMusic: z.string(), cta: z.string(), whyItWorks: z.array(z.string()), ideasForAlmanTec: z.array(z.string()),
});

/** Métricas medidas localmente sobre un vídeo de referencia (sin IA y sin coste). */
async function analyzeReference(file: string) {
  const info = mediaInfo(await ffprobe(file));
  const sha = await sha256File(file);
  const audio = await analyzeAudio(file, sha, info);
  const visual = await analyzeVisual(file, sha, info);
  const cuts = visual.sceneCuts.length;
  let opening = "";
  const t = transcriberFor("equilibrado");
  if (t && audio.speech.length) {
    const wav = await extractWav(file, sha);
    const first = audio.speech.filter((r) => r.start < 6).map((r) => ({ start: r.start, end: Math.min(r.end, 8) }));
    const segs = await t.transcribe(wav, first, { language: "es" });
    opening = segs.map((s) => s.text).join(" ");
  }
  return {
    sha,
    duration: +info.duration.toFixed(1),
    aspect: info.displayWidth && info.displayHeight ? (info.displayWidth > info.displayHeight ? "horizontal" : info.displayWidth === info.displayHeight ? "cuadrado" : "vertical") : "desconocido",
    resolution: `${info.displayWidth}×${info.displayHeight}`,
    cutsPerMinute: info.duration ? +((cuts / info.duration) * 60).toFixed(1) : 0,
    avgShotSeconds: +(info.duration / (cuts + 1)).toFixed(1),
    speechRatio: +audio.speechRatio.toFixed(2),
    firstSpeechAt: audio.speech[0] ? +audio.speech[0].start.toFixed(1) : null,
    openingText: opening,
    keyframes: visual.keyframes.slice(0, 12).map((k) => k.file),
  };
}

export function registerIntelRoutes(app: FastifyInstance) {
  seedHooks();
  // ------- Referencias y competencia -------
  app.get("/api/refs", async () =>
    (db.prepare("SELECT * FROM refs ORDER BY created_at DESC").all() as Record<string, string>[]).map((r) => ({
      id: r.id, kind: r.kind, url: r.url, platform: r.platform, title: r.title, notes: r.notes, manual: parseJson(r.manual, {}),
      analysis: parseJson(r.analysis, null), hasFile: !!r.asset_path, createdAt: r.created_at,
    })),
  );
  const refBody = z.object({
    title: z.string().min(1).max(160), url: z.string().url().max(500).optional().or(z.literal("")), platform: z.enum(PLATFORMS).default("otra"),
    notes: z.string().max(4000).default(""),
    manual: z.object({ views: z.number().nullable().optional(), likes: z.number().nullable().optional(), comments: z.number().nullable().optional(), shares: z.number().nullable().optional(), saves: z.number().nullable().optional(), duration: z.number().nullable().optional(), hookType: z.string().max(60).optional(), hasSubtitles: z.boolean().optional(), hasVoiceover: z.boolean().optional(), hasMusic: z.boolean().optional(), cta: z.string().max(200).optional() }).default({}),
  });
  app.post("/api/refs", async (req) => {
    const b = refBody.parse(req.body);
    const id = newId("ref");
    db.prepare("INSERT INTO refs (id, kind, url, platform, title, notes, manual, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, b.url ? "enlace" : "manual", b.url || null, b.platform, b.title, b.notes, JSON.stringify(b.manual), now());
    return { id };
  });
  app.put("/api/refs/:id", async (req) => {
    const b = refBody.parse(req.body);
    db.prepare("UPDATE refs SET title = ?, url = ?, platform = ?, notes = ?, manual = ? WHERE id = ?").run(b.title, b.url || null, b.platform, b.notes, JSON.stringify(b.manual), (req.params as { id: string }).id);
    return { ok: true };
  });
  app.delete("/api/refs/:id", async (req) => {
    const r = db.prepare("SELECT asset_path FROM refs WHERE id = ?").get((req.params as { id: string }).id) as { asset_path: string | null } | undefined;
    if (r?.asset_path) fs.rmSync(r.asset_path, { force: true });
    db.prepare("DELETE FROM refs WHERE id = ?").run((req.params as { id: string }).id);
    return { ok: true };
  });
  /** Subida de un vídeo de referencia que tengas permiso para analizar: se mide localmente. */
  app.post("/api/refs/:id/video", async (req) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare("SELECT 1 FROM refs WHERE id = ?").get(id)) throw new HttpError(404, "Referencia no encontrada");
    const file = await req.file();
    if (!file) throw new HttpError(400, "Falta el archivo");
    const dest = path.join(paths.references, `${id}${path.extname(file.filename).toLowerCase() || ".mp4"}`);
    await pipeline(file.file, fs.createWriteStream(dest));
    if (file.file.truncated) {
      fs.rmSync(dest, { force: true });
      throw new HttpError(400, `Supera ${config.maxUploadMb} MB`);
    }
    try {
      const analysis = await analyzeReference(dest);
      db.prepare("UPDATE refs SET asset_path = ?, analysis = ?, kind = 'video' WHERE id = ?").run(dest, JSON.stringify({ local: analysis }), id);
      return { analysis };
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw new HttpError(400, `No se pudo analizar el vídeo: ${(e as Error).message}`);
    }
  });
  /** Análisis cualitativo con IA (opcional, de pago): fotogramas reducidos + texto inicial. */
  app.post("/api/refs/:id/ai", async (req) => {
    const id = (req.params as { id: string }).id;
    const r = db.prepare("SELECT * FROM refs WHERE id = ?").get(id) as Record<string, string> | undefined;
    if (!r) throw new HttpError(404, "Referencia no encontrada");
    if (!anthropicStatus().ready) throw new HttpError(400, anthropicStatus().missing!);
    const analysis = parseJson<{ local?: Awaited<ReturnType<typeof analyzeReference>> }>(r.analysis, {});
    const frames = (analysis.local?.keyframes ?? []).filter((f) => fs.existsSync(f)).slice(0, 8);
    const prompt = `Analiza esta referencia de vídeo corto (competencia o inspiración) para un taller de reparación de móviles. No copies nada: extrae técnicas generales.
Título: ${r.title}. Notas del usuario: ${r.notes || "-"}. Datos manuales: ${r.manual}. Métricas medidas: ${JSON.stringify({ ...analysis.local, keyframes: undefined })}.
Si algo no se puede saber con estos datos, dilo explícitamente en ese campo. No afirmes nada sobre el algoritmo.`;
    const est = estimateAnthropicCost(prompt.length, frames.map(() => ({ w: 512, h: 288 })), 1200);
    const block = checkBudget(est.costUsd, 0);
    if (block) throw new HttpError(402, block);
    const res = await anthropicJson({
      system: "Eres analista de contenido para redes sociales. Respondes en español de España, con prudencia y sin inventar datos.",
      prompt, images: frames.map((f, i) => ({ data: fs.readFileSync(f).toString("base64"), label: `Fotograma ${i + 1}:` })), schema: refAiSchema, effort: "low",
    });
    recordUsage({ provider: "anthropic", operation: "analisis_referencia", units: res.usage.inputTokens + res.usage.outputTokens, unitType: "tokens", costUsd: res.usage.costUsd });
    db.prepare("UPDATE refs SET analysis = ? WHERE id = ?").run(JSON.stringify({ ...analysis, ai: res.data, aiCostUsd: res.usage.costUsd }), id);
    return { ai: res.data, costUsd: res.usage.costUsd };
  });

  // ------- Biblioteca de ganchos -------
  app.get("/api/hooks", async () => {
    const hooks = db.prepare("SELECT * FROM hooks ORDER BY created_at DESC").all();
    // Ganchos usados en tus vídeos (extraídos de los planes guardados).
    const used = (db.prepare("SELECT v.id, v.plan, p.name FROM versions v JOIN projects p ON p.id = v.project_id ORDER BY v.created_at DESC LIMIT 200").all() as { id: string; plan: string; name: string }[])
      .map((v) => {
        const plan = parseJson<EditPlan | null>(v.plan, null);
        return plan?.hook ? { versionId: v.id, project: v.name, type: plan.hook.type, text: plan.hook.text } : null;
      })
      .filter(Boolean);
    return { hooks, used };
  });
  const hookBody = z.object({ text: z.string().min(1).max(200), type: z.string().min(1).max(40), notes: z.string().max(1000).default("") });
  app.post("/api/hooks", async (req) => {
    const b = hookBody.parse(req.body);
    const id = newId("hk");
    db.prepare("INSERT INTO hooks (id, text, type, source, notes, created_at) VALUES (?, ?, ?, 'manual', ?, ?)").run(id, b.text, b.type, b.notes, now());
    return { id };
  });
  app.delete("/api/hooks/:id", async (req) => {
    db.prepare("DELETE FROM hooks WHERE id = ?").run((req.params as { id: string }).id);
    return { ok: true };
  });

  // ------- Ideas -------
  app.get("/api/ideas", async () => db.prepare("SELECT * FROM ideas ORDER BY created_at DESC").all());
  app.post("/api/ideas", async (req) => {
    const b = z.object({ text: z.string().min(1).max(500) }).parse(req.body);
    const id = newId("idea");
    db.prepare("INSERT INTO ideas (id, text, status, created_at) VALUES (?, ?, 'pendiente', ?)").run(id, b.text, now());
    return { id };
  });
  app.patch("/api/ideas/:id", async (req) => {
    const b = z.object({ status: z.enum(["pendiente", "grabada", "publicada", "descartada"]) }).parse(req.body);
    db.prepare("UPDATE ideas SET status = ? WHERE id = ?").run(b.status, (req.params as { id: string }).id);
    return { ok: true };
  });
  app.delete("/api/ideas/:id", async (req) => {
    db.prepare("DELETE FROM ideas WHERE id = ?").run((req.params as { id: string }).id);
    return { ok: true };
  });

  // ------- Métricas reales de publicaciones -------
  const metricBody = z.object({
    projectId: z.string(), versionId: z.string().optional(), platform: z.enum(PLATFORMS), postedAt: z.string().max(30).optional(),
    data: z.object({ views: z.number().min(0).optional(), avgWatchSeconds: z.number().min(0).optional(), retention3s: z.number().min(0).max(100).optional(), completionRate: z.number().min(0).max(100).optional(), likes: z.number().min(0).optional(), comments: z.number().min(0).optional(), shares: z.number().min(0).optional(), saves: z.number().min(0).optional(), inquiries: z.number().min(0).optional(), profileVisits: z.number().min(0).optional() }),
    notes: z.string().max(1000).default(""),
  });
  app.get("/api/metrics", async () =>
    (db.prepare("SELECT m.*, p.name AS project FROM metrics m LEFT JOIN projects p ON p.id = m.project_id ORDER BY m.created_at DESC").all() as Record<string, string>[]).map((m) => ({ ...m, data: parseJson(m.data, {}) })),
  );
  app.post("/api/metrics", async (req) => {
    const b = metricBody.parse(req.body);
    const id = newId("met");
    db.prepare("INSERT INTO metrics (id, project_id, version_id, platform, posted_at, data, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, b.projectId, b.versionId ?? null, b.platform, b.postedAt ?? null, JSON.stringify(b.data), b.notes, now());
    return { id };
  });
  app.delete("/api/metrics/:id", async (req) => {
    db.prepare("DELETE FROM metrics WHERE id = ?").run((req.params as { id: string }).id);
    return { ok: true };
  });

  /** Patrones de tus propios datos: medias por característica, con tamaño de muestra. Correlación, no causalidad. */
  app.get("/api/insights", async () => {
    const rows = db.prepare("SELECT m.data, v.plan FROM metrics m LEFT JOIN versions v ON v.id = COALESCE(m.version_id, (SELECT id FROM versions WHERE project_id = m.project_id ORDER BY n DESC LIMIT 1))").all() as { data: string; plan: string | null }[];
    const groups = new Map<string, { views: number[]; completion: number[]; inquiries: number[] }>();
    const add = (k: string, d: Record<string, number>) => {
      const g = groups.get(k) ?? { views: [], completion: [], inquiries: [] };
      if (d.views !== undefined) g.views.push(d.views);
      if (d.completionRate !== undefined) g.completion.push(d.completionRate);
      if (d.inquiries !== undefined) g.inquiries.push(d.inquiries);
      groups.set(k, g);
    };
    for (const r of rows) {
      const d = parseJson<Record<string, number>>(r.data, {});
      const plan = parseJson<EditPlan | null>(r.plan, null);
      if (!plan) continue;
      const dur = plan.timeline.reduce((a, t) => a + (t.end - t.start), 0);
      add(`Gancho: ${plan.hook?.type ?? "ninguno"}`, d);
      add(`Duración: ${dur < 20 ? "< 20 s" : dur < 40 ? "20–40 s" : dur < 60 ? "40–60 s" : "> 60 s"}`, d);
      add(`Ritmo: ${plan.intensity}`, d);
      add(`Voz en off: ${plan.voiceover?.lines.length ? "sí" : "no"}`, d);
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const out = [...groups.entries()].map(([k, g]) => ({ group: k, n: g.views.length, avgViews: avg(g.views), avgCompletion: avg(g.completion), avgInquiries: avg(g.inquiries) })).sort((a, b) => a.group.localeCompare(b.group));
    return {
      total: rows.length,
      groups: out,
      note: rows.length < 10 ? "Hay pocos datos: los resultados aún no son concluyentes. Añade métricas de al menos 10 publicaciones." : "Son correlaciones de tus datos, no causas demostradas. Úsalas como pista, no como regla.",
    };
  });
}
