import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { config } from "../config.js";
import type { ProviderStatus, SpeechRegion, Transcriber, TranscriptSegment, VoiceSynth, Word } from "./types.js";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sherpa = any;
let sherpaMod: Sherpa | null | undefined;
function sherpa(): Sherpa | null {
  if (sherpaMod === undefined) {
    try {
      sherpaMod = require("sherpa-onnx-node");
    } catch {
      sherpaMod = null;
    }
  }
  return sherpaMod;
}

const m = (...p: string[]) => path.join(config.modelsDir, ...p);

export const MODEL_FILES = {
  vad: m("silero_vad.onnx"),
  whisper: (size: "base" | "small") => ({
    encoder: m(`sherpa-onnx-whisper-${size}`, `${size}-encoder.int8.onnx`),
    decoder: m(`sherpa-onnx-whisper-${size}`, `${size}-decoder.int8.onnx`),
    tokens: m(`sherpa-onnx-whisper-${size}`, `${size}-tokens.txt`),
  }),
  piper: {
    femenina: { dir: m("vits-piper-es_ES-sharvard-medium"), model: "es_ES-sharvard-medium.onnx", sid: 1 },
    masculina: { dir: m("vits-piper-es_ES-davefx-medium"), model: "es_ES-davefx-medium.onnx", sid: 0 },
  },
};

const exists = (f: string) => fs.existsSync(f);

/** Lee un WAV PCM mono a 16 kHz generado por FFmpeg. */
export function readWav16k(file: string): Float32Array {
  const s = sherpa();
  if (s) return s.readWave(file).samples as Float32Array;
  const buf = fs.readFileSync(file);
  const dataIdx = buf.indexOf("data") + 8;
  const n = (buf.length - dataIdx) / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataIdx + i * 2) / 32768;
  return out;
}

// ---------- Detección de voz (VAD Silero, local) ----------

export function vadStatus(): ProviderStatus {
  const ready = !!sherpa() && exists(MODEL_FILES.vad);
  return {
    id: "silero-vad", label: "Detección de voz Silero (local)", kind: "vad", external: false, ready, verified: true,
    missing: ready ? undefined : "Ejecuta «npm run models» para descargar silero_vad.onnx",
    costNote: "Gratis: se ejecuta en tu servidor",
  };
}

/** Devuelve los tramos con voz. Si el VAD no está disponible, devuelve null y se usa silencedetect. */
export function detectSpeech(samples: Float32Array, sampleRate = 16000): SpeechRegion[] | null {
  const s = sherpa();
  if (!s || !exists(MODEL_FILES.vad)) return null;
  const windowSize = 512;
  const vad = new s.Vad(
    {
      sileroVad: { model: MODEL_FILES.vad, threshold: 0.5, minSilenceDuration: 0.25, minSpeechDuration: 0.2, windowSize, maxSpeechDuration: 12 },
      sampleRate, numThreads: 1, debug: false,
    },
    Math.ceil(samples.length / sampleRate) + 60,
  );
  const regions: SpeechRegion[] = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      const seg = vad.front(false);
      regions.push({ start: seg.start / sampleRate, end: (seg.start + seg.samples.length) / sampleRate });
      vad.pop();
    }
  };
  for (let i = 0; i + windowSize <= samples.length; i += windowSize) {
    vad.acceptWaveform(samples.subarray(i, i + windowSize));
    drain();
  }
  vad.flush();
  drain();
  return regions;
}

// ---------- Transcripción Whisper (local) ----------

/** Frases que Whisper suele inventar sobre silencio o ruido. */
const HALLUCINATIONS = [
  /subt[ií]tulos (realizados|creados|por)/i, /amara\.org/i, /gracias por ver/i, /suscr[ií]bete/i,
  /^\W*(m[uú]sica|aplausos|risas)\W*$/i, /^[\s.,!?¡¿-]*$/,
];

export function isHallucination(text: string) {
  return HALLUCINATIONS.some((r) => r.test(text.trim()));
}

/** Reparte la duración de un tramo entre sus palabras según su longitud (con pausas en la puntuación). */
export function estimateWordTimes(text: string, start: number, end: number): Word[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weight = (w: string) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,;:!?]$/.test(w) ? 3 : 0);
  const total = words.reduce((a, w) => a + weight(w), 0);
  const dur = Math.max(0.1, end - start);
  let t = start;
  return words.map((w) => {
    const d = (weight(w) / total) * dur;
    const out = { w, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return out;
  });
}

export class LocalWhisper implements Transcriber {
  id: string;
  private recognizer: Sherpa | null = null;
  constructor(private size: "base" | "small") {
    this.id = `whisper-${size}-local`;
  }
  status(): ProviderStatus {
    const f = MODEL_FILES.whisper(this.size);
    const ready = !!sherpa() && exists(f.encoder) && exists(f.decoder) && exists(f.tokens);
    return {
      id: this.id, label: `Whisper ${this.size} (local)`, kind: "transcripcion", external: false, ready, verified: true,
      missing: ready ? undefined : `Ejecuta «npm run models» para descargar el modelo Whisper ${this.size}`,
      costNote: "Gratis: se ejecuta en tu servidor (usa CPU)",
    };
  }
  private get(language: string) {
    if (this.recognizer) return this.recognizer;
    const f = MODEL_FILES.whisper(this.size);
    this.recognizer = new (sherpa()!).OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: { whisper: { encoder: f.encoder, decoder: f.decoder, language, task: "transcribe", tailPaddings: -1 }, tokens: f.tokens, numThreads: Math.max(1, Math.min(8, (config.threads || 4))), debug: 0 },
    });
    return this.recognizer;
  }
  async transcribe(wav: string, regions: SpeechRegion[], opts: { language: string; onProgress?: (d: number, t: number) => void }) {
    if (!this.status().ready) throw new Error(this.status().missing);
    const rec = this.get(opts.language);
    const samples = readWav16k(wav);
    const out: TranscriptSegment[] = [];
    let i = 0;
    for (const r of regions) {
      i++;
      // Margen pequeño para no cortar la primera/última sílaba.
      const a = Math.max(0, Math.floor((r.start - 0.1) * 16000));
      const b = Math.min(samples.length, Math.ceil((r.end + 0.1) * 16000));
      if (b - a < 16000 * 0.3) continue;
      const stream = rec.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples: samples.slice(a, b) });
      rec.decode(stream);
      const text = String(rec.getResult(stream).text ?? "").trim();
      opts.onProgress?.(i, regions.length);
      // Cede el bucle de eventos entre tramos para que el servidor siga respondiendo.
      await new Promise((res) => setImmediate(res));
      if (!text || isHallucination(text)) continue;
      out.push({ start: r.start, end: r.end, text, words: estimateWordTimes(text, r.start, r.end), timing: "segmento" });
    }
    return out;
  }
}

// ---------- Voz en off Piper (local) ----------

export class LocalPiper implements VoiceSynth {
  id = "piper-local";
  private engines = new Map<string, Sherpa>();
  status(): ProviderStatus {
    const ok = Object.values(MODEL_FILES.piper).some((v) => exists(path.join(v.dir, v.model)));
    return {
      id: this.id, label: "Voces Piper español de España (local)", kind: "voz", external: false, ready: !!sherpa() && ok, verified: true,
      missing: ok ? undefined : "Ejecuta «npm run models» para descargar las voces es_ES",
      costNote: "Gratis: se ejecuta en tu servidor. Calidad correcta pero menos natural que un servicio de pago",
    };
  }
  voices() {
    return [
      { id: "femenina", label: "Sharvard (femenina, es-ES)", gender: "femenina" as const },
      { id: "masculina", label: "Davefx (masculina, es-ES)", gender: "masculina" as const },
    ];
  }
  async synthesize(text: string, opts: { voice: "femenina" | "masculina"; speed: number; out: string }) {
    const v = MODEL_FILES.piper[opts.voice];
    let tts = this.engines.get(opts.voice);
    if (!tts) {
      tts = new (sherpa()!).OfflineTts({
        model: { vits: { model: path.join(v.dir, v.model), tokens: path.join(v.dir, "tokens.txt"), dataDir: path.join(v.dir, "espeak-ng-data") }, numThreads: 2, debug: 0 },
        maxNumSentences: 1,
      });
      this.engines.set(opts.voice, tts);
    }
    const sid = Math.min(v.sid, tts.numSpeakers - 1);
    const audio = tts.generate({ text, sid, speed: opts.speed });
    sherpa()!.writeWave(opts.out, { samples: audio.samples, sampleRate: audio.sampleRate });
    return { duration: audio.samples.length / audio.sampleRate, characters: text.length };
  }
}
