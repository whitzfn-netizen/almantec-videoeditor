import fs from "node:fs";
import path from "node:path";
import { getBrand } from "../brand.js";
import { config, paths } from "../config.js";
import { cacheGet, cacheSet, db, newId, now, parseJson } from "../db.js";
import { checkBudget, recordUsage } from "../lib/costs.js";
import { ffprobe, type MediaInfo, mediaInfo } from "../lib/ffmpeg.js";
import type { EditProfile } from "../presets.js";
import { llmFor, transcriberFor, voiceSynth } from "../providers/registry.js";
import type { TranscriptSegment, Word } from "../providers/types.js";
import { analyzeAudio, analyzeVisual, extractWav } from "./analyze.js";
import { assetInfo, jobDir, type ProjectRow, projectAssets, projectProfile, versionDir } from "./context.js";
import { templatePack } from "./pack.js";
import { buildTimeline, heuristicPlan } from "./planner.js";
import { estimatePlanCost, refinePlanWithAi } from "./planner-ai.js";
import { qualityCheck, type QcReport } from "./qc.js";
import { assembleFinal, chooseFps, contentBand, frameAligned, reframeFor, renderCover, renderSegment, type RenderTarget } from "./render.js";
import { STAGES, type StageId } from "./stages.js";
import { buildAss, buildCoverAss, buildSrt, type Caption, checkSafeArea, chunkWords, type OverlayText, STYLE_SPECS } from "./subtitles.js";
import { applyCorrections } from "./text.js";
import type { ClipInput, EditPlan, VoiceLine } from "./types.js";
import { type PlacedLine, splitScript, synthesizeVoiceover, timelineOffsets } from "./voiceover.js";

export interface JobOptions {
  baseVersionId?: string;
  overrides?: { include: string[]; exclude: string[] };
  captionEdits?: Record<string, string>;
  voice?: "femenina" | "masculina";
  voiceoverMode?: EditProfile["voiceover"]["mode"];
  subtitleStyle?: EditProfile["subtitleStyle"];
  variation?: "gancho" | "ritmo";
  hookText?: string;
}

interface JobCtx {
  clips: { assetId: string; name: string; src: string; sha: string; position: number }[];
  target?: RenderTarget;
  transcriber?: string;
  planFile?: string;
  voice?: { wav: string | null; placed: PlacedLine[]; source: string } | null;
  captionsFile?: string;
  assFile?: string | null;
  srtFile?: string;
  video?: { file: string; duration: number; segments: string[]; hookSegment?: { file: string; at: number } };
  qc?: QcReport;
  versionId?: string;
  spentUsd: number;
  warnings: string[];
}

interface JobRow {
  id: string;
  project_id: string;
  type: string;
  status: string;
  options: string;
  attempts: number;
}

export class StageError extends Error {
  constructor(message: string, public help: string) {
    super(message);
  }
}

const FONTS_DIR = process.env.FONTS_DIR ?? (fs.existsSync("/usr/share/fonts/opentype/inter") ? "/usr/share/fonts/opentype/inter" : undefined);

function setStage(jobId: string, stage: StageId, patch: { status?: string; message?: string; provider?: string | null; cost_usd?: number | null; cost_known?: number; detail?: unknown }) {
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = ?`);
    vals.push(k === "detail" ? JSON.stringify(v) : (v as string | number | null));
  }
  if (patch.status === "running") sets.push(`started_at = '${now()}'`, "finished_at = NULL");
  if (patch.status === "done" || patch.status === "failed" || patch.status === "skipped") sets.push(`finished_at = '${now()}'`);
  db.prepare(`UPDATE job_stages SET ${sets.join(", ")} WHERE job_id = ? AND stage = ?`).run(...vals, jobId, stage);
}

function loadClips(ctx: JobCtx, withTranscript = true): ClipInput[] {
  const brand = getBrand();
  return ctx.clips.map((c) => {
    const row = db.prepare("SELECT probe FROM assets WHERE id = ?").get(c.assetId) as { probe: string } | undefined;
    const info = mediaInfo(parseJson(row?.probe, { format: {}, streams: [] }));
    const audio = cacheGet<ClipInput["audio"]>(`audio:v2:${c.sha}`)!;
    const visual = cacheGet<ClipInput["visual"]>(`visual:v2:${c.sha}`) ?? { duration: info.duration, frames: [], sceneCuts: [], keyframes: [] };
    let transcript: TranscriptSegment[] = [];
    if (withTranscript && ctx.transcriber) {
      transcript = (cacheGet<TranscriptSegment[]>(`asr:${ctx.transcriber}:${c.sha}`) ?? []).map((t) => {
        const text = applyCorrections(t.text, brand.corrections);
        if (text === t.text) return t;
        const words = text.split(/\s+/).filter(Boolean);
        // Reasigna tiempos si la corrección cambió el número de palabras.
        if (words.length === t.words.length) return { ...t, text, words: t.words.map((w, i) => ({ ...w, w: words[i] })) };
        const dur = t.end - t.start;
        return { ...t, text, words: words.map((w, i) => ({ w, start: t.start + (dur * i) / words.length, end: t.start + (dur * (i + 1)) / words.length })) };
      });
    }
    return { ...c, info, audio, visual, transcript };
  });
}

const readPlan = (ctx: JobCtx) => JSON.parse(fs.readFileSync(ctx.planFile!, "utf8")) as EditPlan;

function versionRow(id: string) {
  return db.prepare("SELECT * FROM versions WHERE id = ?").get(id) as { id: string; n: number; plan: string; pack: string | null } | undefined;
}

// ---------------- Etapas ----------------

async function stagePreparacion(job: JobRow, ctx: JobCtx, project: ProjectRow, profile: EditProfile) {
  const videos = projectAssets(project.id, "video");
  if (!videos.length) throw new StageError("El proyecto no tiene vídeos", "Sube al menos un clip de vídeo y vuelve a generar.");
  const seen = new Map<string, string>();
  const clips: JobCtx["clips"] = [];
  const infos: MediaInfo[] = [];
  for (const a of videos) {
    if (!fs.existsSync(a.path)) throw new StageError(`Falta el archivo original de «${a.original_name}»`, "El archivo se borró del almacenamiento (¿política de retención?). Vuelve a subirlo.");
    if (seen.has(a.sha256)) {
      ctx.warnings.push(`«${a.original_name}» es idéntico a «${seen.get(a.sha256)}»: se ignora el duplicado.`);
      continue;
    }
    seen.set(a.sha256, a.original_name);
    let info = assetInfo(a);
    if (!info) {
      const probe = await ffprobe(a.path);
      db.prepare("UPDATE assets SET probe = ? WHERE id = ?").run(JSON.stringify(probe), a.id);
      info = mediaInfo(probe);
    }
    if (!info.hasVideo || info.duration < 0.5) {
      ctx.warnings.push(`«${a.original_name}» no tiene imagen utilizable o dura menos de medio segundo: se omite.`);
      continue;
    }
    infos.push(info);
    clips.push({ assetId: a.id, name: a.original_name, src: a.path, sha: a.sha256, position: clips.length });
  }
  if (!clips.length) throw new StageError("Ningún clip es utilizable", "Revisa los avisos de cada archivo: puede que estén dañados o vacíos.");
  ctx.clips = clips;
  const fps = chooseFps(infos, profile.export.fps);
  ctx.target = { width: profile.export.width, height: profile.export.height, fps, quality: profile.export.quality };
  const maxSrc = Math.max(...infos.map((i) => Math.min(i.displayWidth, i.displayHeight)));
  if (maxSrc < Math.min(profile.export.width, profile.export.height)) ctx.warnings.push(`La resolución de origen (${maxSrc}p) es menor que la de salida: el vídeo se ampliará.`);
  return `${clips.length} clip(s) válidos · salida ${ctx.target.width}×${ctx.target.height} a ${fps} fps`;
}

async function stageAudio(job: JobRow, ctx: JobCtx) {
  let speech = 0;
  let total = 0;
  for (const c of ctx.clips) {
    const row = db.prepare("SELECT probe FROM assets WHERE id = ?").get(c.assetId) as { probe: string };
    const info = mediaInfo(JSON.parse(row.probe));
    const a = await analyzeAudio(c.src, c.sha, info);
    speech += a.speechRatio * info.duration;
    total += info.duration;
    setStage(job.id, "analisis_audio", { message: `Analizado «${c.name}»` });
  }
  return `Voz en el ${total ? Math.round((speech / total) * 100) : 0} % del material`;
}

async function stageTranscripcion(job: JobRow, ctx: JobCtx, profile: EditProfile) {
  const t = transcriberFor(profile.processing);
  if (!t) {
    ctx.transcriber = undefined;
    ctx.warnings.push("Sin subtítulos: no hay ningún motor de transcripción disponible (ejecuta «npm run models»).");
    return { skipped: true, message: "Omitida: falta el modelo de transcripción (npm run models)" };
  }
  ctx.transcriber = t.id;
  let words = 0;
  let reused = 0;
  for (const c of ctx.clips) {
    const key = `asr:${t.id}:${c.sha}`;
    let segs = cacheGet<TranscriptSegment[]>(key);
    const audio = cacheGet<ClipInput["audio"]>(`audio:v2:${c.sha}`)!;
    if (segs) reused++;
    else if (!audio.speech.length) segs = [];
    else {
      const wav = await extractWav(c.src, c.sha);
      segs = await t.transcribe(wav, audio.speech, {
        language: "es",
        onProgress: (d, n) => setStage(job.id, "transcripcion", { message: `«${c.name}»: tramo ${d} de ${n}`, detail: { done: d, total: n } }),
      });
      cacheSet(key, "asr", segs);
    }
    words += segs.reduce((a, s) => a + s.words.length, 0);
  }
  return { skipped: false, message: `${words} palabras transcritas con ${t.status().label}${reused ? ` (${reused} clip(s) reutilizados de análisis anteriores)` : ""}`, provider: t.id };
}

async function stageVisual(job: JobRow, ctx: JobCtx) {
  let cuts = 0;
  for (const c of ctx.clips) {
    const row = db.prepare("SELECT probe FROM assets WHERE id = ?").get(c.assetId) as { probe: string };
    const v = await analyzeVisual(c.src, c.sha, mediaInfo(JSON.parse(row.probe)));
    cuts += v.sceneCuts.length;
    setStage(job.id, "analisis_visual", { message: `Analizado «${c.name}»` });
  }
  return `${cuts} cambio(s) de plano detectados`;
}

async function stagePlan(job: JobRow, ctx: JobCtx, project: ProjectRow, profile: EditProfile, opts: JobOptions, dir: string) {
  const clips = loadClips(ctx);
  const brand = getBrand();
  let plan: EditPlan;
  let provider: string | null = "heuristico-local";
  let cost: number | null = 0;
  const base = opts.baseVersionId ? versionRow(opts.baseVersionId) : undefined;
  if (base && opts.variation !== "ritmo") {
    // Reutiliza el plan guardado (incluidas las decisiones de IA) y aplica solo los cambios pedidos.
    plan = JSON.parse(base.plan) as EditPlan;
    plan.removed = plan.removed.filter((r) => r.kind !== "duracion" && r.kind !== "manual");
    const ov = { include: opts.overrides?.include ?? plan.overrides?.include ?? [], exclude: opts.overrides?.exclude ?? plan.overrides?.exclude ?? [] };
    for (const u of plan.units) {
      if (ov.exclude.includes(u.id)) {
        u.include = false;
        u.reason = "Quitado manualmente en la revisión";
        plan.removed.push({ id: `man_${u.id}`, assetId: u.assetId, clipName: u.clipName, start: u.start, end: u.end, kind: "manual", reason: u.reason, text: u.text || undefined });
      } else if (ov.include.includes(u.id) && !u.include) {
        u.include = true;
        u.reason = "Recuperado manualmente en la revisión";
        plan.removed = plan.removed.filter((r) => !(r.assetId === u.assetId && r.start === u.start && r.end === u.end));
      }
    }
    plan.overrides = ov;
    let hookCand = plan.hook?.candidates.find((c) => c.unitId === plan.hook?.unitId) ?? null;
    if (opts.variation === "gancho" && plan.hook) {
      const others = plan.hook.candidates.filter((c) => c.unitId !== plan.hook!.unitId && plan.units.find((u) => u.id === c.unitId)?.include);
      if (!others.length) throw new StageError("No hay otro gancho alternativo", "El material solo ofrece un fragmento apto como gancho. Prueba la variación de ritmo.");
      hookCand = others[0];
      plan.hook = { ...plan.hook, unitId: hookCand.unitId, type: hookCand.type, teaser: hookCand.teaser };
    }
    if (hookCand && !plan.units.find((u) => u.id === hookCand!.unitId)?.include) hookCand = null;
    const order = plan.timeline.filter((t) => !t.teaser).map((t) => t.unitId);
    const { timeline, changes, hookTeaser } = buildTimeline(plan.units, plan.removed, hookCand, profile, clips, order);
    plan.timeline = timeline;
    if (plan.hook) plan.hook.teaser = hookTeaser;
    plan.changes = [...plan.changes.filter((c) => !c.startsWith("Gancho") && !c.startsWith("Duración") && !c.startsWith("Revisión")), ...changes];
    if (opts.variation === "gancho") plan.changes.push("Variación: se usa el segundo mejor gancho.");
    if (opts.overrides) plan.changes.push("Revisión: se aplicaron tus correcciones de fragmentos.");
    if (opts.hookText !== undefined && plan.hook) plan.hook.text = opts.hookText.slice(0, 60);
    provider = plan.ai.used ? `reutilizado (${plan.ai.model})` : "heuristico-local";
    cost = 0;
  } else {
    const p = opts.variation === "ritmo" ? { ...profile, cutIntensity: profile.cutIntensity === "dinamica" ? ("equilibrada" as const) : ("dinamica" as const) } : profile;
    plan = heuristicPlan(clips, p, opts.overrides);
    if (opts.variation === "ritmo") plan.changes.push(`Variación de ritmo: intensidad «${p.cutIntensity}».`);
    const llm = llmFor(profile.processing);
    if (llm && plan.units.some((u) => u.include)) {
      const est = estimatePlanCost(plan, profile, brand, clips, llm);
      const block = checkBudget(est.costUsd, ctx.spentUsd);
      if (block) {
        plan.warnings.push(`No se usó IA de pago: ${block}. Se mantiene el plan automático local.`);
      } else {
        setStage(job.id, "plan", { message: `Consultando a Claude (estimado ${est.costUsd !== null ? est.costUsd.toFixed(3) + " USD" : "coste desconocido"})…` });
        try {
          const wantsVoice = profile.voiceover.mode !== "ninguna";
          const r = await refinePlanWithAi(plan, clips, profile, brand, llm, wantsVoice);
          plan = r.plan;
          cost = r.usage.costUsd;
          ctx.spentUsd += cost ?? 0;
          provider = `anthropic:${llm.model}`;
          recordUsage({ provider: "anthropic", operation: "plan_edicion", units: r.usage.inputTokens + r.usage.outputTokens, unitType: "tokens", costUsd: cost, projectId: project.id });
          fs.writeFileSync(path.join(dir, "ai-voice.json"), JSON.stringify(r.aiVoiceLines));
        } catch (e) {
          plan.warnings.push(`La IA no respondió correctamente (${(e as Error).message}). Se usa el plan automático local.`);
        }
      }
    } else if (profile.processing !== "economico" && !llm) {
      plan.ai.note += " Para selección de escenas y textos con IA, configura ANTHROPIC_API_KEY.";
    }
  }
  plan.warnings = [...new Set([...ctx.warnings, ...plan.warnings])];
  if (!plan.timeline.length) throw new StageError("No queda ningún fragmento para montar", "Todo el material se consideró silencio, negro o inservible. Revisa los clips o recupera fragmentos en la revisión.");
  ctx.planFile = path.join(dir, "plan.json");
  fs.writeFileSync(ctx.planFile, JSON.stringify(plan));
  const dur = plan.timeline.reduce((a, t) => a + (t.end - t.start), 0);
  return { message: `${plan.timeline.length} fragmentos · ${dur.toFixed(1)} s · gancho «${plan.hook?.type ?? "ninguno"}»${plan.ai.used ? " · revisado por IA" : ""}`, provider, cost };
}

async function stageVoz(job: JobRow, ctx: JobCtx, project: ProjectRow, profile: EditProfile, opts: JobOptions, dir: string) {
  const plan = readPlan(ctx);
  const clips = loadClips(ctx, false);
  const mode = opts.voiceoverMode ?? profile.voiceover.mode;
  ctx.voice = null;
  if (mode === "ninguna") return { skipped: true, message: "Sin voz en off (desactivada en el perfil)" };
  const totalDur = clips.reduce((a, c) => a + c.info.duration, 0);
  const speechRatio = clips.reduce((a, c) => a + c.audio.speechRatio * c.info.duration, 0) / Math.max(1, totalDur);
  if (mode === "auto" && speechRatio > 0.2) return { skipped: true, message: `No hace falta: ya hay voz original útil (${Math.round(speechRatio * 100)} % del material)` };
  let lines: VoiceLine[] = [];
  let source = "";
  const scriptAsset = projectAssets(project.id, "script")[0];
  const aiFile = path.join(dir, "ai-voice.json");
  const baseDir = opts.baseVersionId ? path.join(paths.project(project.id), "jobs") : null;
  if (scriptAsset) {
    lines = splitScript(fs.readFileSync(scriptAsset.path, "utf8")).map((text) => ({ text }));
    source = "guion_usuario";
  } else if (fs.existsSync(aiFile)) {
    lines = JSON.parse(fs.readFileSync(aiFile, "utf8"));
    source = "ia";
  } else if (plan.voiceover?.lines.length && baseDir) {
    lines = plan.voiceover.lines;
    source = plan.voiceover.source;
  }
  const cta = getBrand();
  if (!lines.length && mode === "siempre") {
    const { brandCta } = await import("../brand.js");
    const c = brandCta(cta, profile.cta);
    if (c) {
      lines = [{ text: c, timelineKey: plan.timeline[plan.timeline.length - 1]?.key }];
      source = "cta";
    }
  }
  if (!lines.length) return { skipped: true, message: "Sin guion disponible: sube un guion (.txt) o configura la IA para redactarlo" };
  const synth = voiceSynth();
  if (!synth) throw new StageError("No hay motor de voz disponible", "Ejecuta «npm run models» para instalar las voces locales o configura ElevenLabs en el .env.");
  const st = synth.status();
  if (st.external) {
    const { getPrices } = await import("../lib/costs.js");
    const per = getPrices().elevenlabs.perThousandChars;
    const chars = lines.reduce((a, l) => a + l.text.length, 0);
    const block = checkBudget(per === null ? null : (chars / 1000) * per, ctx.spentUsd);
    if (block) throw new StageError(`Voz en off bloqueada: ${block}`, "Introduce la tarifa de ElevenLabs en Configuración › Costes, amplía el límite o elige la voz local.");
  }
  const r = await synthesizeVoiceover(lines, plan.timeline, ctx.target!.fps, synth, { voice: opts.voice ?? profile.voiceover.voice, speed: profile.voiceover.speed, workDir: dir });
  if (st.external) recordUsage({ provider: synth.id, operation: "voz_en_off", units: r.characters, unitType: "caracteres", costUsd: null, projectId: project.id });
  ctx.warnings.push(...r.warnings);
  ctx.voice = { wav: r.wav, placed: r.placed, source };
  plan.voiceover = { source: source as "ia", lines };
  fs.writeFileSync(ctx.planFile!, JSON.stringify(plan));
  return { skipped: false, message: `${r.placed.length} frase(s) con ${st.label}`, provider: synth.id };
}

async function stageSubtitulos(job: JobRow, ctx: JobCtx, profile: EditProfile, opts: JobOptions, dir: string) {
  const plan = readPlan(ctx);
  const clips = loadClips(ctx);
  const t = ctx.target!;
  const brand = getBrand();
  const style = opts.subtitleStyle ?? profile.subtitleStyle;
  const { map, total } = timelineOffsets(plan.timeline, t.fps);
  const words: Word[] = [];
  const zones: { start: number; end: number; marginV: number }[] = [];
  const voiceSpans = (ctx.voice?.placed ?? []).map((p) => ({ s: p.start, e: p.end }));
  const spec = style === "ninguno" ? STYLE_SPECS.limpio : STYLE_SPECS[style];
  for (const it of plan.timeline) {
    const off = map.get(it.key)!;
    const c = clips.find((x) => x.assetId === it.assetId)!;
    const mode = reframeFor(c.info, profile.reframe, t);
    // Con fondo desenfocado, los subtítulos van bajo la banda de imagen y nunca tapan la reparación.
    const band = contentBand(c.info, mode, it.zoom, t);
    const k = t.width / 1080;
    const lineH = spec.size * k * 1.25 * spec.maxLines;
    const below = t.height - band.bottom;
    const marginV = mode === "fondo_desenfocado" && below > lineH + 0.13 * t.height ? Math.round(Math.max(0.13 * t.height, below - lineH - 30 * k) / k) : 480;
    zones.push({ start: off.start, end: off.end, marginV });
    for (const seg of c.transcript) {
      for (const w of seg.words) {
        if (w.start < it.start - 0.05 || w.end > it.end + 0.1) continue;
        const s = off.start + Math.max(0, w.start - it.start);
        const e = Math.min(off.end, off.start + (w.end - it.start));
        if (voiceSpans.some((v) => s < v.e && e > v.s)) continue;
        words.push({ w: w.w, start: s, end: Math.max(s + 0.05, e) });
      }
    }
  }
  for (const p of ctx.voice?.placed ?? []) words.push(...p.words);
  words.sort((a, b) => a.start - b.start);
  const marginFor = (x: number) => zones.find((z) => x >= z.start && x < z.end)?.marginV ?? 480;
  const captions: Caption[] = chunkWords(words, spec, marginFor);
  // Correcciones de texto hechas en la revisión (clave: tiempo de la primera palabra en el origen).
  const edits = opts.captionEdits ?? {};
  const prevEditsFile = opts.baseVersionId ? path.join(versionDirOf(opts.baseVersionId), "caption-edits.json") : null;
  const allEdits = { ...(prevEditsFile && fs.existsSync(prevEditsFile) ? JSON.parse(fs.readFileSync(prevEditsFile, "utf8")) : {}), ...edits } as Record<string, string>;
  for (const c of captions) {
    const key = c.words.map((w) => w.w).join(" ");
    if (allEdits[key] !== undefined) c.text = allEdits[key];
  }
  fs.writeFileSync(path.join(dir, "caption-edits.json"), JSON.stringify(allEdits));
  const overlays: OverlayText[] = [];
  const first = plan.timeline[0];
  if (plan.hook?.text && first) overlays.push({ start: 0, end: Math.min(map.get(first.key)!.end, 3.2) + 0.3, text: plan.hook.text, kind: "gancho" });
  const { brandCta } = await import("../brand.js");
  const cta = plan.publish?.cta || brandCta(brand, profile.cta);
  if (cta && total > 8) overlays.push({ start: Math.max(0, total - 2.8), end: total, text: cta, kind: "cta" });
  const assOpts = { width: t.width, height: t.height, style, accent: brand.accent, highlight: profile.highlightKeywords, keywords: brand.keywords };
  ctx.assFile = path.join(dir, "subs.ass");
  fs.writeFileSync(ctx.assFile, buildAss(captions, overlays, assOpts));
  ctx.srtFile = path.join(dir, "subs.srt");
  fs.writeFileSync(ctx.srtFile, buildSrt(captions));
  ctx.captionsFile = path.join(dir, "captions.json");
  fs.writeFileSync(ctx.captionsFile, JSON.stringify({ captions, overlays, problems: checkSafeArea(captions, assOpts) }));
  if (!words.length) return { skipped: style !== "ninguno" && !overlays.length, message: "Sin voz que subtitular" + (overlays.length ? "; se añaden textos de gancho/CTA" : "") };
  return { skipped: false, message: style === "ninguno" ? "Subtítulos desactivados (se genera igualmente el .srt)" : `${captions.length} subtítulos, estilo «${style}»` };
}

function versionDirOf(versionId: string) {
  const v = db.prepare("SELECT project_id, n FROM versions WHERE id = ?").get(versionId) as { project_id: string; n: number };
  return versionDir(v.project_id, v.n);
}

async function stageRender(job: JobRow, ctx: JobCtx, project: ProjectRow, profile: EditProfile, dir: string) {
  const plan = readPlan(ctx);
  const clips = loadClips(ctx, false);
  const t = ctx.target!;
  const segs: string[] = [];
  let duration = 0;
  let reused = 0;
  let hookSegment: { file: string; at: number } | undefined;
  for (let i = 0; i < plan.timeline.length; i++) {
    const it = plan.timeline[i];
    const c = clips.find((x) => x.assetId === it.assetId)!;
    setStage(job.id, "render", { message: `Fragmento ${i + 1} de ${plan.timeline.length}`, detail: { phase: "fragmentos", done: i, total: plan.timeline.length } });
    const r = await renderSegment({ src: c.src, sha: c.sha, info: c.info, start: it.start, end: it.end, zoom: it.zoom, mode: reframeFor(c.info, profile.reframe, t) }, t);
    if (r.cached) reused++;
    segs.push(r.file);
    if (it.unitId === plan.hook?.unitId && !hookSegment) {
      const kf = c.visual.keyframes.filter((k) => k.t >= it.start && k.t <= it.end).sort((a, b) => b.sharpness - a.sharpness)[0];
      hookSegment = { file: r.file, at: kf ? kf.t - it.start : Math.min(1, r.duration / 2) };
    }
    duration += r.duration;
  }
  if (!hookSegment && segs[0]) hookSegment = { file: segs[0], at: 0.5 };
  // Música: pista elegida en el perfil, audio subido al proyecto o primera pista de tu biblioteca.
  let music: { file: string; volumeDb: number } | null = null;
  if (profile.music.enabled) {
    const projAudio = projectAssets(project.id, "audio")[0];
    const lib = fs.existsSync(paths.music) ? fs.readdirSync(paths.music).filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f)) : [];
    const chosen = projAudio?.path ?? (profile.music.track && lib.includes(profile.music.track) ? path.join(paths.music, profile.music.track) : lib[0] ? path.join(paths.music, lib[0]) : null);
    if (chosen) music = { file: chosen, volumeDb: profile.music.volumeDb };
    else ctx.warnings.push("Música activada pero no hay pistas en tu biblioteca (Configuración › Música): el vídeo sale sin música.");
  }
  const brand = getBrand();
  const logo = brand.showLogo && brand.logo && fs.existsSync(path.join(paths.brand, brand.logo)) ? path.join(paths.brand, brand.logo) : null;
  const out = path.join(dir, "final.mp4");
  await assembleFinal({
    segments: segs, duration, assFile: ctx.assFile ?? null, voiceWav: ctx.voice?.wav ?? null, music, logo, out, target: t, fontsDir: FONTS_DIR,
    onProgress: (f) => setStage(job.id, "render", { message: `Exportando MP4: ${Math.round(f * 100)} %`, detail: { phase: "export", fraction: f } }),
  });
  ctx.video = { file: out, duration, segments: segs, hookSegment };
  return { message: `${duration.toFixed(1)} s exportados${reused ? ` (${reused} fragmento(s) reutilizados)` : ""}${music ? " · con música" : ""}${ctx.voice?.wav ? " · con voz en off" : ""}` };
}

async function stageQc(job: JobRow, ctx: JobCtx) {
  const t = ctx.target!;
  const caps = JSON.parse(fs.readFileSync(ctx.captionsFile!, "utf8")) as { problems: string[] };
  const clips = loadClips(ctx, false);
  const allowSilence = clips.every((c) => !c.info.hasAudio || c.audio.rmsDb.length === 0) && !ctx.voice?.wav;
  const qc = await qualityCheck(ctx.video!.file, { duration: frameAligned(ctx.video!.duration, t.fps), width: t.width, height: t.height, fps: t.fps, allowSilence, subtitleProblems: caps.problems });
  ctx.qc = qc;
  const failed = qc.checks.filter((c) => !c.ok);
  if (!qc.passed) {
    const errs = failed.filter((c) => c.severity === "error");
    throw new StageError(`El control de calidad detectó problemas: ${errs.map((c) => `${c.label} (${c.detail})`).join("; ")}`, "Pulsa «Reintentar». Si se repite, revisa los clips de origen o envía el registro del error.");
  }
  return `${qc.checks.length - failed.length}/${qc.checks.length} comprobaciones superadas${failed.length ? ` · ${failed.length} aviso(s)` : ""}`;
}

async function stageEntrega(job: JobRow, ctx: JobCtx, project: ProjectRow, profile: EditProfile, opts: JobOptions, dir: string) {
  const plan = readPlan(ctx);
  const clips = loadClips(ctx);
  const brand = getBrand();
  const allText = clips.flatMap((c) => c.transcript.map((t) => t.text)).join(" ");
  const pack = { ...(plan.publish ?? templatePack(plan, allText, brand, profile)), source: plan.publish ? "ia" : "plantilla" };
  const n = ((db.prepare("SELECT MAX(n) AS n FROM versions WHERE project_id = ?").get(project.id) as { n: number | null }).n ?? 0) + 1;
  const vdir = versionDir(project.id, n);
  // Portada: fotograma limpio del gancho con la frase de portada.
  const t = ctx.target!;
  const coverAss = path.join(dir, "cover.ass");
  fs.writeFileSync(coverAss, buildCoverAss(pack.coverText, { width: t.width, height: t.height, accent: brand.accent }));
  const cover = path.join(vdir, "portada.jpg");
  if (ctx.video?.hookSegment) await renderCover(ctx.video.hookSegment.file, ctx.video.hookSegment.at, pack.coverText ? coverAss : null, cover, FONTS_DIR);
  const files = { video: path.join(vdir, "video.mp4"), srt: path.join(vdir, "subtitulos.srt"), ass: path.join(vdir, "subtitulos.ass") };
  fs.renameSync(ctx.video!.file, files.video);
  fs.copyFileSync(ctx.srtFile!, files.srt);
  if (ctx.assFile) fs.copyFileSync(ctx.assFile, files.ass);
  fs.copyFileSync(ctx.captionsFile!, path.join(vdir, "captions.json"));
  if (fs.existsSync(path.join(dir, "caption-edits.json"))) fs.copyFileSync(path.join(dir, "caption-edits.json"), path.join(vdir, "caption-edits.json"));
  plan.warnings = [...new Set([...plan.warnings, ...ctx.warnings])];
  const id = newId("ver");
  const label = job.type === "generate" ? "Generado" : job.type === "variation" ? `Variación (${opts.variation})` : "Revisión";
  db.prepare("INSERT INTO versions (id, project_id, n, label, plan, video_path, cover_path, subtitles_path, pack, qc, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, project.id, n, label, JSON.stringify(plan), files.video, fs.existsSync(cover) ? cover : null, files.srt, JSON.stringify(pack), JSON.stringify(ctx.qc ?? null), now(),
  );
  if (fs.existsSync(cover)) db.prepare("UPDATE projects SET thumbnail = ? WHERE id = ?").run(cover, project.id);
  ctx.versionId = id;
  return { message: `Versión ${n} guardada · pack de publicación ${pack.source === "ia" ? "redactado por IA" : "por plantilla (sin IA)"}`, provider: pack.source === "ia" ? "anthropic" : "plantilla-local" };
}

// ---------------- Orquestación ----------------

export async function runJob(jobId: string) {
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as unknown as JobRow;
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(job.project_id) as unknown as ProjectRow;
  const profile = projectProfile(project);
  const opts = parseJson<JobOptions>(job.options, {});
  const dir = jobDir(project.id, job.id);
  const ctxFile = path.join(dir, "ctx.json");
  const ctx: JobCtx = fs.existsSync(ctxFile) ? JSON.parse(fs.readFileSync(ctxFile, "utf8")) : { clips: [], spentUsd: 0, warnings: [] };
  const save = () => fs.writeFileSync(ctxFile, JSON.stringify(ctx));
  db.prepare("UPDATE projects SET status = 'processing', error = NULL, updated_at = ? WHERE id = ?").run(now(), project.id);
  const stages = db.prepare("SELECT stage, status FROM job_stages WHERE job_id = ? ORDER BY position").all(job.id) as { stage: StageId; status: string }[];
  for (const s of stages) {
    if (s.status === "done" || s.status === "skipped") continue; // reanudación desde la última etapa completada
    db.prepare("UPDATE jobs SET current_stage = ? WHERE id = ?").run(s.stage, job.id);
    setStage(job.id, s.stage, { status: "running", message: STAGES.find((x) => x.id === s.stage)!.what });
    try {
      let res: string | { message: string; skipped?: boolean; provider?: string | null; cost?: number | null };
      switch (s.stage) {
        case "preparacion": res = await stagePreparacion(job, ctx, project, profile); break;
        case "analisis_audio": res = await stageAudio(job, ctx); break;
        case "transcripcion": res = await stageTranscripcion(job, ctx, profile); break;
        case "analisis_visual": res = await stageVisual(job, ctx); break;
        case "plan": res = await stagePlan(job, ctx, project, profile, opts, dir); break;
        case "voz": res = await stageVoz(job, ctx, project, profile, opts, dir); break;
        case "subtitulos": res = await stageSubtitulos(job, ctx, profile, opts, dir); break;
        case "render": res = await stageRender(job, ctx, project, profile, dir); break;
        case "control_calidad": res = await stageQc(job, ctx); break;
        case "entrega": res = await stageEntrega(job, ctx, project, profile, opts, dir); break;
      }
      const r = typeof res === "string" ? { message: res } : res;
      save();
      setStage(job.id, s.stage, {
        status: r.skipped ? "skipped" : "done", message: r.message,
        provider: r.provider ?? null, cost_usd: r.cost === undefined ? 0 : r.cost, cost_known: r.cost === null ? 0 : 1,
        detail: s.stage === "control_calidad" ? ctx.qc : null,
      });
    } catch (e) {
      save();
      const err = e as Error & { help?: string; stderrTail?: string };
      const help = err.help ?? (err.stderrTail ? "Error de FFmpeg al procesar el vídeo. Pulsa «Reintentar»; si se repite, puede que un clip esté dañado." : "Pulsa «Reintentar». El trabajo continuará desde esta etapa.");
      setStage(job.id, s.stage, { status: "failed", message: err.message, detail: { help, log: err.stderrTail?.slice(-1500) } });
      db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(`${err.message}. ${help}`, now(), job.id);
      db.prepare("UPDATE projects SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(`${STAGES.find((x) => x.id === s.stage)!.label}: ${err.message}`, now(), project.id);
      if (!config.production) console.error(e);
      return;
    }
  }
  db.prepare("UPDATE jobs SET status = 'done', version_id = ?, finished_at = ?, current_stage = NULL WHERE id = ?").run(ctx.versionId ?? null, now(), job.id);
  db.prepare("UPDATE projects SET status = 'done', updated_at = ? WHERE id = ?").run(now(), project.id);
  // Limpieza de temporales del trabajo (la versión ya tiene sus archivos).
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".mp4") || f === "voz") fs.rmSync(path.join(dir, f), { recursive: true, force: true });
}

export function enqueueJob(projectId: string, type: "generate" | "rerender" | "variation", options: JobOptions = {}) {
  const active = db.prepare("SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued','running')").get(projectId) as { id: string } | undefined;
  if (active) throw new StageError("Ya hay un trabajo en curso para este proyecto", "Espera a que termine o cancélalo.");
  const id = newId("job");
  db.prepare("INSERT INTO jobs (id, project_id, type, status, options, created_at) VALUES (?, ?, ?, 'queued', ?, ?)").run(id, projectId, type, JSON.stringify(options), now());
  const ins = db.prepare("INSERT INTO job_stages (job_id, stage, position) VALUES (?, ?, ?)");
  STAGES.forEach((s, i) => ins.run(id, s.id, i));
  db.prepare("UPDATE projects SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?").run(now(), projectId);
  return id;
}

/** Reintenta un trabajo fallido conservando las etapas ya completadas. */
export function retryJob(jobId: string) {
  db.prepare("UPDATE job_stages SET status = 'pending', message = NULL WHERE job_id = ? AND status IN ('failed','running')").run(jobId);
  db.prepare("UPDATE jobs SET status = 'queued', error = NULL, attempts = attempts + 1 WHERE id = ?").run(jobId);
  const j = db.prepare("SELECT project_id FROM jobs WHERE id = ?").get(jobId) as { project_id: string };
  db.prepare("UPDATE projects SET status = 'queued', error = NULL WHERE id = ?").run(j.project_id);
}
