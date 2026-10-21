import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { cacheGet, cacheSet } from "../db.js";
import { ffmpeg, type MediaInfo } from "../lib/ffmpeg.js";
import { detectSpeech, readWav16k } from "../providers/local-speech.js";
import type { SpeechRegion } from "../providers/types.js";

/** Cambiar al modificar el algoritmo para invalidar la caché. */
const AUDIO_VERSION = 2;
const VISUAL_VERSION = 2;

export interface AudioAnalysis {
  duration: number;
  speech: SpeechRegion[];
  speechSource: "vad" | "silencedetect" | "sin_audio";
  /** Energía RMS en dBFS cada 0,1 s. */
  rmsDb: number[];
  noiseFloorDb: number;
  speechRatio: number;
}

export interface VisualFrame {
  t: number;
  /** Diferencia con el fotograma anterior (0-1): movimiento / cambio de plano. */
  scene: number;
  /** Brillo medio (0-255). */
  yavg: number;
  /** Desenfoque estimado (mayor = más borroso). */
  blur: number;
}

export interface VisualAnalysis {
  duration: number;
  frames: VisualFrame[];
  sceneCuts: number[];
  /** Fotogramas clave representativos (JPG) para miniaturas, portada y visión por IA. */
  keyframes: { t: number; file: string; sharpness: number }[];
}

export function wavPath(sha: string) {
  return path.join(paths.cache, `${sha}.16k.wav`);
}

export async function extractWav(src: string, sha: string): Promise<string> {
  const out = wavPath(sha);
  if (!fs.existsSync(out)) {
    const tmp = out + ".tmp.wav";
    await ffmpeg(["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp]);
    fs.renameSync(tmp, out);
  }
  return out;
}

function rmsWindows(samples: Float32Array, sr = 16000, win = 0.1): number[] {
  const n = Math.floor(sr * win);
  const out: number[] = [];
  for (let i = 0; i + n <= samples.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += samples[j] * samples[j];
    const rms = Math.sqrt(s / n);
    out.push(rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90);
  }
  return out;
}

function percentile(arr: number[], p: number) {
  if (!arr.length) return -90;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** Respaldo sin VAD: tramos sin silencio según silencedetect de FFmpeg. */
async function silenceDetectRegions(src: string, duration: number): Promise<SpeechRegion[]> {
  const r = await ffmpeg(["-i", src, "-vn", "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"], { allowFail: true });
  const silences: { s: number; e: number }[] = [];
  let cur: number | null = null;
  for (const line of r.stderr.split("\n")) {
    const a = line.match(/silence_start: ([\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) cur = Number(a[1]);
    if (b && cur !== null) {
      silences.push({ s: cur, e: Number(b[1]) });
      cur = null;
    }
  }
  if (cur !== null) silences.push({ s: cur, e: duration });
  const out: SpeechRegion[] = [];
  let t = 0;
  for (const s of silences) {
    if (s.s - t > 0.2) out.push({ start: t, end: s.s });
    t = s.e;
  }
  if (duration - t > 0.2) out.push({ start: t, end: duration });
  return out;
}

export async function analyzeAudio(src: string, sha: string, info: MediaInfo): Promise<AudioAnalysis> {
  const key = `audio:v${AUDIO_VERSION}:${sha}`;
  const cached = cacheGet<AudioAnalysis>(key);
  if (cached) return cached;
  let result: AudioAnalysis;
  if (!info.hasAudio) {
    result = { duration: info.duration, speech: [], speechSource: "sin_audio", rmsDb: [], noiseFloorDb: -90, speechRatio: 0 };
  } else {
    const wav = await extractWav(src, sha);
    const samples = readWav16k(wav);
    const rmsDb = rmsWindows(samples);
    let speech = detectSpeech(samples);
    let speechSource: AudioAnalysis["speechSource"] = "vad";
    if (!speech) {
      speech = await silenceDetectRegions(src, info.duration);
      speechSource = "silencedetect";
    }
    const speechTime = speech.reduce((a, r) => a + (r.end - r.start), 0);
    result = { duration: info.duration, speech, speechSource, rmsDb, noiseFloorDb: percentile(rmsDb, 0.1), speechRatio: info.duration ? speechTime / info.duration : 0 };
  }
  cacheSet(key, "audio", result);
  return result;
}

export async function analyzeVisual(src: string, sha: string, info: MediaInfo): Promise<VisualAnalysis> {
  const key = `visual:v${VISUAL_VERSION}:${sha}`;
  const cached = cacheGet<VisualAnalysis>(key);
  if (cached && cached.keyframes.every((k) => fs.existsSync(k.file))) return cached;
  if (!info.hasVideo) {
    const empty: VisualAnalysis = { duration: info.duration, frames: [], sceneCuts: [], keyframes: [] };
    return empty;
  }
  const metaFile = path.join(paths.cache, `${sha}.meta.txt`);
  // Una sola pasada a baja resolución y 5 fps: cambio de escena, brillo y desenfoque.
  await ffmpeg([
    "-i", src, "-an",
    "-vf", `fps=5,scale=320:-2,select='gte(scene\\,0)',signalstats,blurdetect=block_width=32:block_height=32,metadata=mode=print:file=${metaFile.replace(/\\/g, "/").replace(/:/g, "\\:")}`,
    "-f", "null", "-",
  ]);
  const frames: VisualFrame[] = [];
  let cur: Partial<VisualFrame> | null = null;
  for (const line of fs.readFileSync(metaFile, "utf8").split("\n")) {
    const f = line.match(/pts_time:([\d.]+)/);
    if (f) {
      if (cur && cur.t !== undefined) frames.push({ t: cur.t, scene: cur.scene ?? 0, yavg: cur.yavg ?? 128, blur: cur.blur ?? 0 });
      cur = { t: Number(f[1]) };
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^lavfi\.([\w.]+)=([-\d.eE+]+)/);
    if (!kv) continue;
    if (kv[1] === "scene_score") cur.scene = Number(kv[2]);
    else if (kv[1] === "signalstats.YAVG") cur.yavg = Number(kv[2]);
    else if (kv[1] === "blur") cur.blur = Number(kv[2]);
  }
  if (cur && cur.t !== undefined) frames.push({ t: cur.t, scene: cur.scene ?? 0, yavg: cur.yavg ?? 128, blur: cur.blur ?? 0 });
  fs.rmSync(metaFile, { force: true });
  if (frames.length) frames[0].scene = 0;

  const sceneCuts = frames.filter((f) => f.scene > 0.35).map((f) => f.t);
  // Un fotograma clave por plano (entre cortes), el más nítido y bien expuesto; máximo uno cada ~4 s.
  const bounds = [0, ...sceneCuts, info.duration];
  const picks: { t: number; sharpness: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const parts = Math.max(1, Math.round((b - a) / 4));
    for (let k = 0; k < parts; k++) {
      const s = a + ((b - a) * k) / parts;
      const e = a + ((b - a) * (k + 1)) / parts;
      const cand = frames.filter((f) => f.t >= s + 0.2 && f.t <= e - 0.2 && f.yavg > 25);
      if (!cand.length) continue;
      const best = cand.reduce((x, y) => (y.blur < x.blur ? y : x));
      picks.push({ t: best.t, sharpness: 1 / (1 + best.blur) });
    }
  }
  const keyframes: VisualAnalysis["keyframes"] = [];
  const kfDir = path.join(paths.cache, `${sha}.kf`);
  fs.mkdirSync(kfDir, { recursive: true });
  for (const p of picks.slice(0, 60)) {
    const file = path.join(kfDir, `${p.t.toFixed(2)}.jpg`);
    if (!fs.existsSync(file)) await ffmpeg(["-ss", p.t.toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", file]);
    keyframes.push({ t: p.t, file, sharpness: p.sharpness });
  }
  const result: VisualAnalysis = { duration: info.duration, frames, sceneCuts, keyframes };
  cacheSet(key, "visual", result);
  return result;
}

/** Estadísticas visuales de un intervalo. */
export function visualStats(v: VisualAnalysis, start: number, end: number) {
  const fr = v.frames.filter((f) => f.t >= start && f.t < end);
  if (!fr.length) return { motion: 0, brightness: 128, blur: 0, cuts: 0, dark: false, blurry: false, black: false };
  const avg = (k: keyof VisualFrame) => fr.reduce((a, f) => a + f[k], 0) / fr.length;
  const brightness = avg("yavg");
  const blur = avg("blur");
  return {
    motion: avg("scene"),
    brightness,
    blur,
    cuts: v.sceneCuts.filter((t) => t >= start && t < end).length,
    black: brightness < 16,
    dark: brightness < 35,
    blurry: blur > 9,
  };
}

/** Energía de audio media (dB) en un intervalo. */
export function audioEnergy(a: AudioAnalysis, start: number, end: number) {
  const i = Math.floor(start * 10);
  const j = Math.max(i + 1, Math.ceil(end * 10));
  const w = a.rmsDb.slice(i, j);
  if (!w.length) return -90;
  return 10 * Math.log10(w.reduce((s, d) => s + Math.pow(10, d / 10), 0) / w.length);
}
