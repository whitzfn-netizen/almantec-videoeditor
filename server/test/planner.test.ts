import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { heuristicPlan } from "../src/pipeline/planner.js";
import type { ClipInput } from "../src/pipeline/types.js";
import { defaultProfile } from "../src/presets.js";
import { estimateWordTimes } from "../src/providers/local-speech.js";

/** Clip sintético: voz en los tramos indicados, movimiento constante y ruido de fondo bajo. */
function clip(id: string, pos: number, dur: number, speech: [number, number, string][], opts: { black?: [number, number]; motion?: number } = {}): ClipInput {
  const frames = [];
  for (let t = 0; t < dur; t += 0.2) {
    const black = opts.black && t >= opts.black[0] && t < opts.black[1];
    frames.push({ t, scene: black ? 0 : (opts.motion ?? 0.002), yavg: black ? 5 : 120, blur: 2 });
  }
  const rmsDb = Array.from({ length: Math.floor(dur * 10) }, (_, i) => (speech.some(([a, b]) => i / 10 >= a && i / 10 < b) ? -20 : -60));
  return {
    assetId: id, name: `${id}.mp4`, src: "", sha: id, position: pos,
    info: { duration: dur, hasVideo: true, hasAudio: true, width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080, rotation: 0, fps: 30 },
    audio: { duration: dur, speech: speech.map(([start, end]) => ({ start, end })), speechSource: "vad", rmsDb, noiseFloorDb: -60, speechRatio: speech.reduce((a, [s, e]) => a + e - s, 0) / dur },
    visual: { duration: dur, frames, sceneCuts: [], keyframes: [] },
    transcript: speech.map(([start, end, text]) => ({ start, end, text, words: estimateWordTimes(text, start, end), timing: "segmento" as const })),
  };
}

test("elimina silencios sin cortar las frases y registra lo eliminado", () => {
  const c = clip("a", 0, 20, [[2, 5, "Hoy cambiamos la pantalla de este iPhone."], [9, 12, "Primero quitamos los tornillos de la base."]]);
  const plan = heuristicPlan([c], defaultProfile());
  const kept = plan.timeline.filter((t) => !t.teaser);
  for (const [s, e] of [[2, 5], [9, 12]]) assert.ok(kept.some((t) => t.start <= s && t.end >= e), `la frase ${s}-${e} queda completa`);
  const removed = plan.removed.filter((r) => r.kind === "silencio" || r.kind === "pausa");
  assert.ok(removed.reduce((a, r) => a + r.end - r.start, 0) > 10, "se quitan los silencios");
  assert.ok(plan.changes[0].startsWith("Eliminados"));
});

test("con una toma repetida conserva la última", () => {
  const c = clip("a", 0, 16, [[1, 4, "Primero quitamos los tornillos y separamos la pantalla."], [6, 10, "Primero quitamos los tornillos y separamos la pantalla con cuidado."]]);
  const plan = heuristicPlan([c], defaultProfile());
  assert.ok(plan.removed.some((r) => r.kind === "repeticion" && r.start === 1));
  assert.ok(plan.timeline.some((t) => t.start <= 6 && t.end >= 10));
  assert.ok(!plan.timeline.some((t) => !t.teaser && t.start <= 1.5 && t.end >= 3.5));
});

test("la intensidad cambia cuánto se recorta de las pausas", () => {
  const speech: [number, number, string][] = [[1, 3, "Esto es una prueba de corte."], [3.7, 6, "Y aquí sigue la explicación."]];
  const suave = heuristicPlan([clip("a", 0, 8, speech)], { ...defaultProfile(), cutIntensity: "suave" });
  const dinamica = heuristicPlan([clip("a", 0, 8, speech)], { ...defaultProfile(), cutIntensity: "dinamica" });
  const dur = (p: typeof suave) => p.timeline.filter((t) => !t.teaser).reduce((a, t) => a + t.end - t.start, 0);
  assert.ok(dur(dinamica) < dur(suave), "dinámica es más corta que suave");
});

test("descarta tramos en negro y elige un gancho de resultado al final", () => {
  const a = clip("a", 0, 10, [[1, 4, "Este móvil llegó con la pantalla rota."]], { black: [6, 9], motion: 0.03 });
  const b = clip("b", 1, 6, [[0.5, 4, "Y aquí está el resultado: funciona perfectamente."]]);
  const plan = heuristicPlan([a, b], defaultProfile());
  assert.ok(plan.removed.some((r) => r.kind === "negro"));
  assert.ok(plan.timeline.every((t) => !(t.assetId === "a" && t.start < 8.5 && t.end > 6.5)), "no hay negro en el montaje");
  assert.equal(plan.hook?.type, "resultado");
  assert.ok(plan.hook!.candidates.length >= 2 && plan.hook!.candidates.length <= 3);
  assert.equal(plan.timeline[0].assetId, "b", "abre con el resultado");
});

test("respeta la duración objetivo quitando lo menos interesante", () => {
  const speech: [number, number, string][] = [];
  for (let i = 0; i < 10; i++) speech.push([i * 6 + 1, i * 6 + 5, `Paso número ${i + 1} de la reparación con el destornillador ${i}.`]);
  const plan = heuristicPlan([clip("a", 0, 62, speech)], { ...defaultProfile(), targetDuration: 20 });
  const dur = plan.timeline.reduce((a, t) => a + t.end - t.start, 0);
  assert.ok(dur <= 20 * 1.15, `duración ${dur}`);
  assert.ok(plan.removed.some((r) => r.kind === "duracion"));
});
