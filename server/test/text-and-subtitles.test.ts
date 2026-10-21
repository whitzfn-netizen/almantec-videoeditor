import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateWordTimes, isHallucination } from "../src/providers/local-speech.js";
import { buildAss, buildSrt, checkSafeArea, chunkWords, STYLE_SPECS } from "../src/pipeline/subtitles.js";
import { applyCorrections, detectDevices, isFillerOnly, similarity } from "../src/pipeline/text.js";

test("detecta tomas repetidas y no confunde frases distintas", () => {
  assert.ok(similarity("Primero quitamos los tornillos y separamos la pantalla", "Primero quitamos los tornillos y separamos la pantalla con cuidado") >= 0.7);
  assert.ok(similarity("Primero quitamos los tornillos", "Ahora limpiamos el conector de carga del iPhone") < 0.3);
});

test("reconoce fragmentos que solo tienen muletillas", () => {
  assert.equal(isFillerOnly("Eh... bueno, pues"), true);
  assert.equal(isFillerOnly("Bueno, cambiamos la batería"), false);
});

test("filtra frases inventadas por Whisper sobre silencio", () => {
  assert.equal(isHallucination("Subtítulos realizados por la comunidad de Amara.org"), true);
  assert.equal(isHallucination("La pantalla funciona"), false);
});

test("detecta dispositivos mencionados literalmente", () => {
  assert.deepEqual(detectDevices("hoy reparamos un iphone 12 pro y un samsung"), ["iPhone 12 Pro", "Samsung"]);
});

test("aplica el diccionario de correcciones de la marca", () => {
  assert.equal(applyCorrections("el ifon de almantek", { ifon: "iPhone", almantek: "AlmanTec" }), "el iPhone de AlmanTec");
});

test("los tiempos de palabra estimados cubren el tramo sin solaparse", () => {
  const w = estimateWordTimes("Hoy cambiamos la pantalla, mira.", 2, 4);
  assert.equal(w.length, 5);
  assert.equal(w[0].start, 2);
  assert.ok(Math.abs(w[w.length - 1].end - 4) < 0.01);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end - 1e-6);
});

test("subtítulos cortos, sin solapes y dentro de la zona segura", () => {
  const words = estimateWordTimes("Hoy vamos a cambiar la pantalla de este iPhone 12, que llegó con el cristal roto. Primero quitamos los tornillos.", 0, 7);
  const caps = chunkWords(words, STYLE_SPECS.almantec, () => 480);
  assert.ok(caps.length >= 3);
  for (let i = 0; i < caps.length; i++) {
    assert.ok(caps[i].end > caps[i].start);
    if (i) assert.ok(caps[i].start >= caps[i - 1].end - 1e-6, "sin solapes");
    assert.ok(caps[i].words.map((x) => x.w).join(" ").length <= STYLE_SPECS.almantec.maxChars * 2);
  }
  const opts = { width: 1080, height: 1920, style: "almantec" as const, accent: "#22D3EE", highlight: true, keywords: [] };
  assert.deepEqual(checkSafeArea(caps, opts), []);
  const ass = buildAss(caps, [{ start: 0, end: 2, text: "Así quedó", kind: "gancho" }], opts);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Dialogue: 1,.*Hook/);
  assert.match(ass, /\{\\c&H00EED322\}pantalla/i, "resalta palabras clave con el color de acento");
  const srt = buildSrt(caps);
  assert.match(srt, /^1\n00:00:00,000 --> /);
});

test("estilo dinámico: una palabra activa resaltada por evento", () => {
  const words = estimateWordTimes("mira este resultado", 0, 1.5);
  const caps = chunkWords(words, STYLE_SPECS.dinamico, () => 480);
  const ass = buildAss(caps, [], { width: 1080, height: 1920, style: "dinamico", accent: "#22D3EE", highlight: false, keywords: [] });
  assert.equal((ass.match(/^Dialogue: 0/gm) ?? []).length, 3);
});
