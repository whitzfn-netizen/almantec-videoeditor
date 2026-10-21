import fs from "node:fs";
import { z } from "zod";
import type { Brand } from "../brand.js";
import { anthropicJson, estimateAnthropicCost } from "../providers/anthropic.js";
import type { LlmImage } from "../providers/types.js";
import type { EditProfile } from "../presets.js";
import { buildTimeline, hookCandidates } from "./planner.js";
import type { ClipInput, EditPlan, NarrativeRole } from "./types.js";

const ROLES = ["gancho", "contexto", "desarrollo", "prueba", "cierre"] as const;

export const aiPlanSchema = z.object({
  topic: z.string(),
  audience: z.string(),
  objective: z.enum(["alcance", "retencion", "mostrar_reparacion", "demostrar_experiencia", "transformacion", "confianza", "consultas", "promocion", "visitas"]),
  units: z.array(z.object({ id: z.string(), description: z.string(), interest: z.number(), include: z.boolean(), role: z.enum(ROLES), reason: z.string() })),
  hooks: z.array(z.object({ unitId: z.string(), type: z.string(), score: z.number(), overlayText: z.string(), why: z.string() })),
  chosenHookUnitId: z.string(),
  order: z.array(z.string()),
  voiceover: z.array(z.object({ unitId: z.string(), text: z.string() })),
  publish: z.object({
    titles: z.array(z.string()),
    description: z.string(),
    hashtags: z.array(z.object({ tag: z.string(), why: z.string() })),
    cta: z.string(),
    coverText: z.string(),
    hookSummary: z.string(),
  }),
  warnings: z.array(z.string()),
});
export type AiPlan = z.infer<typeof aiPlanSchema>;

const SYSTEM = `Eres el editor jefe de AlmanTec Viral Studio, especializado en vídeos verticales cortos de reparación de móviles y electrónica para Instagram Reels, TikTok y YouTube Shorts.
Recibes fragmentos ya detectados automáticamente (con transcripción, métricas y algunos fotogramas). Tu trabajo es decidir el montaje.
Reglas estrictas:
- No inventes averías, resultados, precios, especificaciones, testimonios ni datos de contacto. Usa solo lo que se ve u oye en el material y los datos de marca facilitados.
- Si no puedes identificar un componente o dispositivo con seguridad, no lo nombres.
- El primer fragmento debe ser interesante desde el primer segundo. Prioriza fragmentos que cuenten algo o muestren una transformación, no solo los bonitos.
- No prometas viralidad ni resultados en el algoritmo. Títulos honestos, nada engañoso.
- La voz en off solo si aporta valor; si ya hay voz original útil, no la tapes: devuelve la lista vacía. Cada línea debe describir lo que se ve en ese fragmento, nunca algo que todavía no ha ocurrido.
- Hashtags: pocos y relevantes, cada uno justificado.
- Escribe en español de España.`;

/** Selecciona fotogramas representativos de las unidades más interesantes (muestreo inteligente, no todos los fotogramas). */
function pickFrames(plan: EditPlan, clips: ClipInput[], max: number): { images: LlmImage[]; dims: { w: number; h: number }[] } {
  const ranked = plan.units.filter((u) => u.include).sort((a, b) => b.scores.interest - a.scores.interest);
  const images: LlmImage[] = [];
  const dims: { w: number; h: number }[] = [];
  const seen = new Set<string>();
  for (const u of ranked) {
    if (images.length >= max) break;
    const c = clips.find((x) => x.assetId === u.assetId)!;
    const kf = c.visual.keyframes.filter((k) => k.t >= u.start && k.t <= u.end).sort((a, b) => b.sharpness - a.sharpness)[0];
    if (!kf || seen.has(kf.file) || !fs.existsSync(kf.file)) continue;
    seen.add(kf.file);
    images.push({ data: fs.readFileSync(kf.file).toString("base64"), label: `Fotograma de la unidad ${u.id} (t=${kf.t.toFixed(1)} s del clip «${c.name}»):` });
    const ar = c.info.displayWidth / Math.max(1, c.info.displayHeight);
    dims.push(ar >= 1 ? { w: 512, h: Math.round(512 / ar) } : { w: Math.round(512 * ar), h: 512 });
  }
  return { images, dims };
}

function buildPrompt(plan: EditPlan, profile: EditProfile, brand: Brand, wantsVoice: boolean) {
  const units = plan.units.map((u) => ({
    id: u.id, clip: u.clipName, inicio: u.start, fin: u.end, duracion: +(u.end - u.start).toFixed(2), tipo: u.kind,
    incluida_por_defecto: u.include, motivo: u.reason, texto: u.text || undefined,
    interes_estimado: u.scores.interest, calidad: u.scores.quality, movimiento: u.stats.motion, brillo: u.stats.brightness,
  }));
  return `DATOS DE MARCA (no inventes otros): ${JSON.stringify({ nombre: brand.name, servicios: brand.services, web: brand.web || undefined, contacto: brand.contact || undefined, ubicacion: brand.showLocation ? brand.location : undefined, llamadas_a_la_accion: brand.ctas })}
PREFERENCIAS: objetivo=${profile.objective}, duracion_objetivo=${profile.targetDuration || "automática"} s, estilo_gancho=${profile.hookStyle}, estilo_voz=${profile.voiceover.style}, voz_en_off=${wantsVoice ? "permitida si aporta valor" : "no"}, cta_preferida=${profile.cta || "la de la marca"}.
CANDIDATOS DE GANCHO CALCULADOS: ${JSON.stringify(plan.hook?.candidates ?? [])}
UNIDADES (ya sin silencios ni pausas; orden cronológico): ${JSON.stringify(units)}
Tareas:
1. Describe cada unidad en una frase, puntúa su interés (0-10), decide si se incluye y su función narrativa (gancho, contexto, desarrollo, prueba, cierre) con un motivo.
2. Propón exactamente tres ganchos (unitId de unidades incluidas), puntúalos (0-10), con un texto en pantalla de máximo 7 palabras, y elige el mejor en chosenHookUnitId.
3. Devuelve en "order" los ids de las unidades incluidas (sin el gancho) en el orden de montaje que mejor cuenta la historia.
4. ${wantsVoice ? "Si aporta valor, escribe la voz en off como líneas breves asociadas a unidades (máx. 2,5 palabras por segundo de la unidad)." : "Devuelve voiceover vacío."}
5. Prepara el pack de publicación: 3 títulos, descripción, hasta 8 hashtags justificados, CTA, frase de portada (máx. 6 palabras) y resumen del gancho.
6. Añade avisos si el material tiene carencias.`;
}

export function estimatePlanCost(plan: EditPlan, profile: EditProfile, brand: Brand, clips: ClipInput[], llm: { model: string; maxFrames: number }) {
  const { dims } = pickFrames(plan, clips, llm.maxFrames);
  const prompt = SYSTEM + buildPrompt(plan, profile, brand, true);
  return estimateAnthropicCost(prompt.length, dims, 1500 + plan.units.length * 80, llm.model);
}

/** Refina el plan heurístico con una sola llamada a Claude y valida cada decisión. */
export async function refinePlanWithAi(plan: EditPlan, clips: ClipInput[], profile: EditProfile, brand: Brand, llm: { model: string; effort: "low" | "medium" | "high"; maxFrames: number }, wantsVoice: boolean) {
  const { images } = pickFrames(plan, clips, llm.maxFrames);
  const { data, usage, model } = await anthropicJson({ system: SYSTEM, prompt: buildPrompt(plan, profile, brand, wantsVoice), images, schema: aiPlanSchema, effort: llm.effort, model: llm.model });
  const byId = new Map(plan.units.map((u) => [u.id, u]));
  for (const au of data.units) {
    const u = byId.get(au.id);
    if (!u) continue;
    u.description = au.description.slice(0, 300);
    u.scores.interest = Math.max(0, Math.min(1, au.interest / 10));
    u.role = au.role as NarrativeRole;
    if (plan.overrides?.include.includes(u.id) || plan.overrides?.exclude.includes(u.id)) continue;
    // La IA no puede recuperar lo eliminado por negro; sí puede descartar fragmentos.
    if (u.include && !au.include) {
      u.include = false;
      u.reason = `IA: ${au.reason}`;
      plan.removed.push({ id: `ai_${u.id}`, assetId: u.assetId, clipName: u.clipName, start: u.start, end: u.end, kind: "ia", reason: `Descartado por la IA: ${au.reason}`, text: u.text || undefined });
    } else if (!u.include && au.include && u.reason !== "Imagen en negro") {
      u.include = true;
      u.reason = `IA: ${au.reason}`;
      plan.removed = plan.removed.filter((r) => !(r.assetId === u.assetId && r.start === u.start && r.end === u.end));
    } else u.reason = au.reason;
  }
  const all = hookCandidates(plan.units, clips, profile, 0);
  const chosen = all.find((c) => c.unitId === data.chosenHookUnitId) ?? all[0] ?? null;
  const aiHook = data.hooks.find((h) => h.unitId === chosen?.unitId);
  const candidates = data.hooks
    .map((h) => {
      const c = all.find((x) => x.unitId === h.unitId);
      return c ? { ...c, total: Math.max(0, Math.min(1, h.score / 10)), type: h.type || c.type, why: h.why } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  // Mantener la línea temporal coherente con las decisiones validadas.
  plan.removed = plan.removed.filter((r) => r.kind !== "duracion");
  const { timeline, changes, hookTeaser } = buildTimeline(plan.units, plan.removed, chosen, profile, clips, data.order);
  plan.timeline = timeline;
  plan.changes = [...plan.changes.filter((c) => !c.startsWith("Gancho") && !c.startsWith("Duración")), ...changes, "Selección de escenas, orden y textos revisados por IA."];
  plan.hook = chosen ? { unitId: chosen.unitId, type: aiHook?.type || chosen.type, text: profile.hookText ? (aiHook?.overlayText ?? "").slice(0, 60) : "", teaser: hookTeaser, candidates: candidates.length ? candidates : all.slice(0, 3) } : null;
  plan.topic = data.topic;
  plan.audience = data.audience;
  if (profile.objective === "auto") plan.objective = data.objective;
  const keyByUnit = new Map(timeline.map((t) => [t.unitId, t.key]));
  const lines = data.voiceover.filter((v) => keyByUnit.has(v.unitId) && v.text.trim()).map((v) => ({ text: v.text.trim().slice(0, 400), timelineKey: keyByUnit.get(v.unitId) }));
  const publish = { ...data.publish, titles: data.publish.titles.slice(0, 3), hashtags: data.publish.hashtags.slice(0, 8).map((h) => ({ tag: h.tag.startsWith("#") ? h.tag : `#${h.tag}`, why: h.why })) };
  plan.publish = publish;
  plan.warnings = [...plan.warnings, ...data.warnings.map((w) => `IA: ${w}`)];
  plan.ai = { used: true, provider: "anthropic", model, costUsd: usage.costUsd, note: `Una llamada (${usage.inputTokens} tokens de entrada, ${usage.outputTokens} de salida, ${images.length} fotogramas).` };
  return { plan, aiVoiceLines: lines, usage };
}
