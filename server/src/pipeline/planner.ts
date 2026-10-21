import { now } from "../db.js";
import type { EditProfile } from "../presets.js";
import type { SpeechRegion } from "../providers/types.js";
import { audioEnergy, visualStats } from "./analyze.js";
import { curiosityHits, detectDevices, isFillerOnly, problemHits, resultHits, similarity, techHits } from "./text.js";
import type { ClipInput, EditPlan, HookCandidate, NarrativeRole, Removed, TimelineItem, Unit } from "./types.js";

export const INTENSITY = {
  suave: { mergeGap: 0.9, padPre: 0.2, padPost: 0.32, maxActionRun: 10, minAction: 1.2, actionMergeGap: 1.2 },
  equilibrada: { mergeGap: 0.5, padPre: 0.12, padPost: 0.22, maxActionRun: 6, minAction: 1.0, actionMergeGap: 0.8 },
  dinamica: { mergeGap: 0.3, padPre: 0.08, padPost: 0.16, maxActionRun: 3.5, minAction: 0.8, actionMergeGap: 0.5 },
} as const;

/** Umbrales de actividad visual/sonora para tramos sin voz. */
const MOTION_ACTIVE = 0.012;
const ENERGY_ACTIVE_OVER_FLOOR = 14;

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
let removedSeq = 0;

function removed(c: ClipInput, start: number, end: number, kind: Removed["kind"], reason: string, text?: string): Removed {
  return { id: `rm${++removedSeq}`, assetId: c.assetId, clipName: c.name, start: r3(start), end: r3(end), kind, reason, text };
}

function mergeIntervals(list: SpeechRegion[], gap: number): SpeechRegion[] {
  const s = [...list].sort((a, b) => a.start - b.start);
  const out: SpeechRegion[] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r.start - last.end <= gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function subtract(range: SpeechRegion, cuts: SpeechRegion[]): SpeechRegion[] {
  let parts = [range];
  for (const c of cuts) {
    parts = parts.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const res: SpeechRegion[] = [];
      if (c.start > p.start) res.push({ start: p.start, end: c.start });
      if (c.end < p.end) res.push({ start: c.end, end: p.end });
      return res;
    });
  }
  return parts;
}

/** Paso 1: tramos de voz útiles (sin tomas repetidas ni muletillas sueltas). */
function usefulSpeech(clips: ClipInput[], removedLog: Removed[]) {
  const segs = clips.flatMap((c) => c.transcript.map((t, i) => ({ c, t, i, drop: false })));
  // Tomas repetidas: si una frase se repite (≥70 % de palabras), se conserva la última toma.
  for (let a = 0; a < segs.length; a++) {
    for (let b = a + 1; b < segs.length; b++) {
      if (!segs[a].drop && similarity(segs[a].t.text, segs[b].t.text) >= 0.7) {
        segs[a].drop = true;
        removedLog.push(removed(segs[a].c, segs[a].t.start, segs[a].t.end, "repeticion", "Toma repetida: se conserva la versión posterior", segs[a].t.text));
        break;
      }
    }
  }
  for (const s of segs) {
    if (!s.drop && isFillerOnly(s.t.text)) {
      s.drop = true;
      removedLog.push(removed(s.c, s.t.start, s.t.end, "muletilla", "Solo contiene muletillas", s.t.text));
    }
  }
  const byClip = new Map<string, { keep: SpeechRegion[]; drop: SpeechRegion[] }>();
  for (const c of clips) byClip.set(c.assetId, { keep: [], drop: [] });
  for (const s of segs) byClip.get(s.c.assetId)![s.drop ? "drop" : "keep"].push({ start: s.t.start, end: s.t.end });
  // Tramos con voz detectada pero sin transcripción (sin proveedor de transcripción): se conservan.
  for (const c of clips) {
    const entry = byClip.get(c.assetId)!;
    if (!c.transcript.length) entry.keep.push(...c.audio.speech);
  }
  return byClip;
}

function windowsActive(c: ClipInput, start: number, end: number, step = 0.5) {
  const out: SpeechRegion[] = [];
  for (let t = start; t < end - 0.05; t += step) {
    const e = Math.min(end, t + step);
    const v = visualStats(c.visual, t, e);
    const energy = audioEnergy(c.audio, t, e);
    const activeAudio = c.info.hasAudio && energy > c.audio.noiseFloorDb + ENERGY_ACTIVE_OVER_FLOOR;
    const activeVisual = v.motion > MOTION_ACTIVE || v.cuts > 0;
    if ((activeAudio || activeVisual) && !v.black) out.push({ start: t, end: e });
  }
  return out;
}

function makeUnit(c: ClipInput, start: number, end: number, kind: Unit["kind"], totalDur: number, offset: number, idx: number): Unit {
  const v = visualStats(c.visual, start, end);
  const energy = audioEnergy(c.audio, start, end);
  const text = c.transcript
    .filter((t) => t.end > start + 0.05 && t.start < end - 0.05)
    .map((t) => t.text)
    .join(" ")
    .trim();
  const words = text ? text.split(/\s+/).length : 0;
  const dur = Math.max(0.1, end - start);
  const quality = clamp(1 - (v.dark ? 0.45 : 0) - (v.blurry ? 0.35 : 0) - (v.black ? 0.8 : 0));
  const relevance = text ? clamp(0.35 + techHits(text) * 0.15) : 0.5;
  const motionN = clamp(v.motion / 0.06);
  const energyN = c.info.hasAudio ? clamp((energy - c.audio.noiseFloorDb) / 30) : 0.3;
  const density = clamp(words / dur / 2.6);
  const interest = clamp((0.32 * motionN + 0.18 * energyN + 0.28 * density + 0.22 * relevance) * (0.4 + 0.6 * quality) + (kind === "voz" ? 0.08 : 0));
  return {
    id: `u${c.position}_${idx}`,
    assetId: c.assetId,
    clipName: c.name,
    start: r3(start),
    end: r3(end),
    kind,
    text,
    description: kind === "voz" ? `Habla: «${text.slice(0, 90)}${text.length > 90 ? "…" : ""}»` : `Acción sin voz${v.motion > 0.03 ? " con movimiento" : ""}${energyN > 0.4 ? " y sonido de trabajo" : ""}`,
    role: "desarrollo",
    include: true,
    reason: kind === "voz" ? "Contiene voz útil" : "Hay actividad visual o sonora",
    relPos: totalDur ? (offset + (start + end) / 2) / totalDur : 0,
    scores: { interest: r3(interest), quality: r3(quality), relevance: r3(relevance) },
    stats: { motion: r3(v.motion), brightness: Math.round(v.brightness), blur: r3(v.blur), energyDb: Math.round(energy), words, dark: v.dark, blurry: v.blurry },
  };
}

/** Paso 2: unidades candidatas por clip y registro de lo eliminado. */
export function buildUnits(clips: ClipInput[], profile: EditProfile) {
  const P = INTENSITY[profile.cutIntensity];
  const removedLog: Removed[] = [];
  const warnings: string[] = [];
  const speech = usefulSpeech(clips, removedLog);
  const totalDur = clips.reduce((a, c) => a + c.info.duration, 0);
  const units: Unit[] = [];
  let offset = 0;
  for (const c of clips) {
    const dur = c.info.duration;
    const sp = speech.get(c.assetId)!;
    // Bloques de voz: se unen las pausas cortas (respiraciones naturales) y se añade margen para no cortar sílabas.
    const blocks = mergeIntervals(
      mergeIntervals(sp.keep, P.mergeGap).map((b) => ({ start: Math.max(0, b.start - P.padPre), end: Math.min(dur, b.end + P.padPost) })),
      0.05,
    );
    const voiced = blocks.map((b) => subtract(b, sp.drop.map((d) => ({ start: d.start - 0.05, end: d.end + 0.05 })))).flat().filter((b) => b.end - b.start > 0.3);

    // Tramos sin voz: solo se conservan los que tienen acción visual o sonidos de trabajo.
    const gaps = subtract({ start: 0, end: dur }, [...voiced, ...sp.drop]);
    const actions: SpeechRegion[] = [];
    for (const g of gaps) {
      const runs = mergeIntervals(windowsActive(c, g.start, g.end), P.actionMergeGap).filter((r) => r.end - r.start >= P.minAction);
      for (const r of runs) {
        // Esperas largas sin voz: se conserva el fragmento más activo.
        if (r.end - r.start > P.maxActionRun) {
          let best = r.start;
          let bestScore = -1;
          for (let t = r.start; t + P.maxActionRun <= r.end; t += 0.5) {
            const s = visualStats(c.visual, t, t + P.maxActionRun).motion * 10 + (audioEnergy(c.audio, t, t + P.maxActionRun) - c.audio.noiseFloorDb) / 30;
            if (s > bestScore) {
              bestScore = s;
              best = t;
            }
          }
          if (best > r.start) removedLog.push(removed(c, r.start, best, "espera", "Tramo largo sin voz: se acorta y se conserva la parte más activa"));
          if (best + P.maxActionRun < r.end) removedLog.push(removed(c, best + P.maxActionRun, r.end, "espera", "Tramo largo sin voz: se acorta y se conserva la parte más activa"));
          actions.push({ start: best, end: best + P.maxActionRun });
        } else actions.push(r);
      }
      // Lo que queda del hueco es silencio o pausa sin actividad.
      for (const rest of subtract(g, runs)) {
        if (rest.end - rest.start < 0.25) continue;
        if (visualStats(c.visual, rest.start, rest.end).black) {
          removedLog.push(removed(c, rest.start, rest.end, "negro", "Imagen en negro"));
          continue;
        }
        const between = voiced.some((v) => Math.abs(v.end - rest.start) < 0.01) && voiced.some((v) => Math.abs(v.start - rest.end) < 0.01);
        removedLog.push(removed(c, rest.start, rest.end, between ? "pausa" : "silencio", between ? "Pausa entre frases sin actividad" : "Silencio o tramo sin actividad"));
      }
    }

    let idx = 0;
    const all = [
      ...voiced.map((v) => ({ ...v, kind: "voz" as const })),
      ...actions.map((a) => ({ ...a, kind: "accion" as const })),
    ].sort((a, b) => a.start - b.start);
    for (const it of all) {
      const u = makeUnit(c, it.start, it.end, it.kind, totalDur, offset, idx++);
      const st = visualStats(c.visual, it.start, it.end);
      if (st.black) {
        u.include = false;
        u.reason = "Imagen en negro";
        removedLog.push(removed(c, u.start, u.end, "negro", "Imagen en negro"));
      } else if (u.kind === "accion" && (st.dark || st.blurry)) {
        u.include = false;
        u.reason = st.dark ? "Imagen demasiado oscura y sin voz" : "Imagen desenfocada y sin voz";
        removedLog.push(removed(c, u.start, u.end, "calidad", u.reason));
      } else if (u.kind === "voz" && (st.dark || st.blurry)) {
        warnings.push(`«${c.name}» ${fmt(u.start)}–${fmt(u.end)}: se conserva por la voz, pero la imagen está ${st.dark ? "oscura" : "desenfocada"}.`);
      }
      units.push(u);
    }
    // Avisos de calidad del clip completo.
    const whole = visualStats(c.visual, 0, dur);
    if (c.info.hasVideo && whole.dark) warnings.push(`«${c.name}» está muy oscuro en general; el resultado puede verse mal.`);
    if (c.info.hasVideo && whole.blurry) warnings.push(`«${c.name}» parece desenfocado en general.`);
    if (!c.info.hasAudio) warnings.push(`«${c.name}» no tiene pista de audio; se usará solo su imagen.`);
    if (Math.min(c.info.displayWidth, c.info.displayHeight) < 720 && c.info.hasVideo) warnings.push(`«${c.name}» tiene baja resolución (${c.info.displayWidth}×${c.info.displayHeight}); se ampliará y perderá nitidez.`);
    offset += dur;
  }
  return { units, removed: removedLog, warnings };
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** Paso 3: candidatos de gancho con puntuación explicable. */
export function hookCandidates(units: Unit[], clips: ClipInput[], profile: EditProfile, limit = 3): HookCandidate[] {
  const included = units.filter((u) => u.include);
  const lastUnitId = included[included.length - 1]?.id;
  const cands: HookCandidate[] = [];
  for (const u of included) {
    const clip = clips.find((c) => c.assetId === u.assetId)!;
    const text = u.text;
    const transformacion = clamp((u.relPos > 0.75 ? 0.5 : 0) + resultHits(text) * 0.25 + (u.id === lastUnitId ? 0.25 : 0));
    const breakdown = {
      impacto: clamp(u.stats.motion / 0.05) * 0.7 + clamp((u.stats.brightness - 40) / 120) * 0.3,
      claridad: u.scores.quality,
      curiosidad: clamp(curiosityHits(text) * 0.25 + problemHits(text) * 0.2),
      relevancia: u.scores.relevance,
      transformacion,
      relacion: u.kind === "voz" ? 0.7 : 0.5,
    };
    let type = "demostracion";
    if (transformacion >= 0.5) type = "resultado";
    else if (text.includes("?")) type = "pregunta";
    else if (problemHits(text) > 0) type = "problema_solucion";
    const style = profile.hookStyle;
    let bias = 0;
    if (style !== "auto") {
      if ((style === "resultado" || style === "antes_despues") && type === "resultado") bias = 0.25;
      else if (style === type) bias = 0.25;
    }
    const total = clamp(
      0.24 * breakdown.impacto + 0.2 * breakdown.claridad + 0.18 * breakdown.curiosidad + 0.14 * breakdown.relevancia + 0.18 * breakdown.transformacion + 0.06 * breakdown.relacion + bias,
    );
    // Segmento del gancho: corto (≤ 4,5 s) y sin cortar palabras.
    let start = u.start;
    let end = u.end;
    if (end - start > 4.5) {
      if (u.kind === "voz") {
        const seg = clip.transcript.find((t) => t.start >= u.start - 0.2 && t.end <= u.end + 0.2 && t.end - t.start <= 5.5 && t.text.split(/\s+/).length >= 3);
        if (!seg) continue;
        start = Math.max(u.start, seg.start - 0.1);
        end = Math.min(u.end, seg.end + 0.2);
      } else {
        // Ventana más activa de 3 s.
        let best = u.start;
        let bs = -1;
        for (let t = u.start; t + 3 <= u.end; t += 0.5) {
          const s = visualStats(clip.visual, t, t + 3).motion;
          if (s > bs) {
            bs = s;
            best = t;
          }
        }
        start = best;
        end = best + 3;
      }
    }
    const teaser = type === "resultado" || u.relPos > 0.5;
    const why = [
      breakdown.transformacion >= 0.5 ? "muestra un resultado o transformación" : "",
      breakdown.impacto > 0.5 ? "tiene impacto visual" : "",
      breakdown.curiosidad > 0.3 ? "despierta curiosidad" : "",
      breakdown.relevancia > 0.6 ? "es muy relevante para el tema" : "",
      breakdown.claridad < 0.6 ? "aunque la imagen no es perfecta" : "",
    ].filter(Boolean).join(", ") || "es el fragmento más sólido disponible";
    cands.push({ unitId: u.id, type, start: r3(start), end: r3(end), teaser, total: r3(total), breakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, r3(v)])) as HookCandidate["breakdown"], why });
  }
  cands.sort((a, b) => b.total - a.total);
  // Tres candidatos de fragmentos distintos (o todos, si se pide).
  return limit > 0 ? cands.slice(0, limit) : cands;
}

const HOOK_TEXTS: Record<string, (device?: string) => string> = {
  resultado: (d) => (d ? `Así quedó este ${d}` : "Mira cómo queda al final"),
  antes_despues: (d) => (d ? `${d}: antes y después` : "Antes y después"),
  pregunta: () => "¿Sabías esto?",
  problema_solucion: (d) => (d ? `Problema en un ${d}: así se soluciona` : "Así se soluciona esta avería"),
  demostracion: (d) => (d ? `Reparación de ${d} paso a paso` : "Mira este proceso"),
};

/** Texto del gancho sin IA: plantillas que solo usan lo que aparece en el audio. */
export function templateHookText(type: string, devices: string[], style: EditProfile["hookStyle"]) {
  const t = style === "antes_despues" ? "antes_despues" : type;
  return (HOOK_TEXTS[t] ?? HOOK_TEXTS.demostracion)(devices[0]);
}

function assignRoles(timeline: TimelineItem[]) {
  timeline.forEach((it, i) => {
    let role: NarrativeRole = "desarrollo";
    if (it.teaser || (i === 0 && timeline.length > 1)) role = "gancho";
    else if (i === timeline.length - 1) role = "cierre";
    else if (i >= timeline.length - 3 && timeline.length > 4) role = "prueba";
    else if (i === 1) role = "contexto";
    it.role = role;
  });
}

/** Paso 4: línea temporal final (gancho, desarrollo cronológico, prueba y cierre) ajustada a la duración. */
export function buildTimeline(units: Unit[], removedLog: Removed[], hook: HookCandidate | null, profile: EditProfile, clips: ClipInput[], order?: string[]) {
  const changes: string[] = [];
  let body = units.filter((u) => u.include);
  if (order?.length) {
    // Orden propuesto (IA o revisión); las unidades no mencionadas mantienen su orden cronológico al final.
    const pos = new Map(order.map((id, i) => [id, i]));
    body = [...body].sort((a, b) => (pos.get(a.id) ?? 1e6 + units.indexOf(a)) - (pos.get(b.id) ?? 1e6 + units.indexOf(b)));
  }
  const target = profile.targetDuration > 0 ? profile.targetDuration : 90;
  const hookDur = hook && hook.teaser ? hook.end - hook.start : 0;
  const dur = () => body.reduce((a, u) => a + (u.end - u.start), 0) + hookDur;
  const protectedIds = new Set([hook?.unitId, body[body.length - 1]?.id].filter(Boolean) as string[]);
  if (dur() > target * 1.12) {
    const before = dur();
    const ranked = [...body].filter((u) => !protectedIds.has(u.id)).sort((a, b) => a.scores.interest - b.scores.interest);
    for (const u of ranked) {
      if (dur() <= target * 1.05) break;
      body = body.filter((x) => x.id !== u.id);
      u.include = false;
      u.reason = `Menor interés estimado; se quita para acercarse a la duración objetivo (${target} s)`;
      const c = clips.find((x) => x.assetId === u.assetId)!;
      removedLog.push(removed(c, u.start, u.end, "duracion", u.reason, u.text || undefined));
    }
    changes.push(`Duración reducida de ${before.toFixed(1)} s a ${dur().toFixed(1)} s quitando los fragmentos de menor interés.`);
  }
  const timeline: TimelineItem[] = [];
  let hookTeaser = false;
  if (hook) {
    const hu = units.find((u) => u.id === hook.unitId)!;
    const hookCovers = (hook.end - hook.start) / Math.max(0.1, hu.end - hu.start);
    if (hook.teaser && hookCovers >= 0.7 && body[body.length - 1]?.id === hu.id) {
      // El avance sería casi todo el fragmento final: se abre con el resultado en lugar de repetirlo.
      body = [hu, ...body.filter((u) => u.id !== hu.id)];
      changes.push(`Gancho: se abre con el resultado final de «${hu.clipName}» y después se muestra el proceso (${hook.why}).`);
    } else if (hook.teaser) {
      hookTeaser = true;
      timeline.push({ key: "hook", unitId: hu.id, assetId: hu.assetId, start: hook.start, end: hook.end, role: "gancho", zoom: profile.zoom === "moderado" ? 1.06 : 1, teaser: true });
      changes.push(`Gancho: avance de ${(hook.end - hook.start).toFixed(1)} s del momento final al principio (${hook.why}).`);
    } else {
      body = [hu, ...body.filter((u) => u.id !== hu.id)];
      changes.push(`Gancho: se abre con el fragmento de «${hu.clipName}» (${hook.why}).`);
    }
  }
  let prev: TimelineItem | undefined = timeline[timeline.length - 1];
  let alt = false;
  for (const u of body) {
    const jump = prev && prev.assetId === u.assetId && !prev.teaser && Math.abs(prev.end - u.start) > 0.08;
    // Zoom moderado alterno en cortes dentro del mismo plano para disimular saltos.
    if (jump) alt = !alt;
    else alt = false;
    const zoom = profile.zoom === "moderado" && alt ? 1.08 : 1;
    const it: TimelineItem = { key: u.id, unitId: u.id, assetId: u.assetId, start: u.start, end: u.end, role: "desarrollo", zoom };
    timeline.push(it);
    prev = it;
  }
  assignRoles(timeline);
  for (const it of timeline) {
    const u = units.find((x) => x.id === it.unitId);
    if (u && !it.teaser) u.role = it.role;
  }
  return { timeline, changes, hookTeaser };
}

export function heuristicPlan(clips: ClipInput[], profile: EditProfile, overrides?: EditPlan["overrides"]): EditPlan {
  removedSeq = 0;
  const { units, removed: removedLog, warnings } = buildUnits(clips, profile);
  if (overrides) {
    for (const u of units) {
      if (overrides.exclude.includes(u.id)) {
        u.include = false;
        u.reason = "Quitado manualmente en la revisión";
      }
      if (overrides.include.includes(u.id)) {
        u.include = true;
        u.reason = "Recuperado manualmente en la revisión";
      }
    }
  }
  const included = units.filter((u) => u.include);
  if (!included.length) {
    warnings.push("No se ha encontrado ningún fragmento con voz o actividad suficiente. Revisa que los clips tengan contenido útil.");
  }
  const cands = hookCandidates(units, clips, profile);
  const best = cands[0] ?? null;
  const allText = clips.flatMap((c) => c.transcript.map((t) => t.text)).join(" ");
  const devices = detectDevices(allText);
  const { timeline, changes, hookTeaser } = buildTimeline(units, removedLog, best, profile, clips);
  if (overrides?.exclude.length || overrides?.include.length) changes.push("Se aplicaron las correcciones manuales de la revisión.");
  const removedTotal = removedLog.filter((r) => r.kind !== "duracion").reduce((a, r) => a + (r.end - r.start), 0);
  const byKind = (k: Removed["kind"]) => removedLog.filter((r) => r.kind === k);
  if (removedTotal > 0) changes.unshift(`Eliminados ${removedTotal.toFixed(1)} s de silencios, pausas, esperas, repeticiones y tramos inservibles.`);
  if (byKind("repeticion").length) changes.push(`${byKind("repeticion").length} toma(s) repetida(s) eliminada(s); se conserva la última.`);
  if (byKind("muletilla").length) changes.push(`${byKind("muletilla").length} fragmento(s) con solo muletillas eliminado(s).`);
  const speechRatio = clips.reduce((a, c) => a + c.audio.speechRatio * c.info.duration, 0) / Math.max(1, clips.reduce((a, c) => a + c.info.duration, 0));
  const objective = profile.objective !== "auto" ? profile.objective : devices.length || techHits(allText) > 2 ? "mostrar_reparacion" : "alcance";
  return {
    version: 1,
    createdAt: now(),
    intensity: profile.cutIntensity,
    objective,
    topic: devices.length ? `Reparación / servicio técnico: ${devices.join(", ")}` : techHits(allText) ? "Reparación de dispositivos" : "Contenido demostrativo",
    audience: "Personas con un dispositivo averiado que buscan un servicio técnico de confianza",
    hook: best ? { unitId: best.unitId, type: best.type, text: profile.hookText ? templateHookText(best.type, devices, profile.hookStyle) : "", teaser: hookTeaser, candidates: cands } : null,
    units,
    removed: removedLog,
    timeline,
    voiceover: null,
    warnings: speechRatio < 0.05 && clips.some((c) => c.info.hasAudio) ? [...warnings, "Apenas hay voz en el material: el montaje se basa en la actividad visual y sonora."] : warnings,
    changes,
    ai: { used: false, note: "Plan generado con análisis de audio, vídeo y transcripción local (sin IA de pago)." },
  };
}
