import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.js";
import { ffmpeg, type MediaInfo } from "../lib/ffmpeg.js";
import type { EditProfile } from "../presets.js";

export interface RenderTarget {
  width: number;
  height: number;
  fps: number;
  quality: EditProfile["export"]["quality"];
}

export type ReframeMode = "fondo_desenfocado" | "recorte_centro";

export function reframeFor(info: MediaInfo, pref: EditProfile["reframe"], target: RenderTarget): ReframeMode {
  if (pref === "fondo_desenfocado" || pref === "recorte_centro") return pref;
  const srcAspect = info.displayWidth / Math.max(1, info.displayHeight);
  const dstAspect = target.width / target.height;
  // Si el origen es bastante más ancho que el destino, recortar haría desaparecer manos o dispositivo:
  // se encaja completo sobre un fondo desenfocado del propio plano.
  return srcAspect > dstAspect * 1.25 ? "fondo_desenfocado" : "recorte_centro";
}

/** Frecuencia de salida coherente con el material: la dominante, redondeada a valores estándar. */
export function chooseFps(infos: MediaInfo[], pref: EditProfile["export"]["fps"]): number {
  if (pref !== "origen") return pref;
  const weights = new Map<number, number>();
  for (const i of infos) {
    if (!i.hasVideo) continue;
    const std = [24, 25, 30, 50, 60].reduce((a, b) => (Math.abs(b - i.fps) < Math.abs(a - i.fps) ? b : a), 30);
    weights.set(std, (weights.get(std) ?? 0) + i.duration);
  }
  let best = 30;
  let w = -1;
  for (const [f, d] of weights) if (d > w) [best, w] = [f, d];
  return best;
}

function videoFilter(mode: ReframeMode, zoom: number, t: RenderTarget) {
  const { width: W, height: H, fps } = t;
  const even = (x: number) => Math.round(x / 2) * 2;
  if (mode === "fondo_desenfocado") {
    const fgW = even(W * zoom);
    return [
      `[0:v]split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${even(W / 4)}:${even(H / 4)}:force_original_aspect_ratio=increase,crop=${even(W / 4)}:${even(H / 4)},boxblur=10:2,scale=${W}:${H},eq=brightness=-0.09:saturation=0.9[bg]`,
      `[fgsrc]scale=${fgW}:-2,crop='min(iw,${W})':'min(ih,${H})'[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=${fps},setsar=1,format=yuv420p[v]`,
    ].join(";");
  }
  const zW = even(W * zoom);
  const zH = even(H * zoom);
  return `[0:v]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${W}:${H},fps=${fps},setsar=1,format=yuv420p[v]`;
}

/** Dimensiones de la banda de vídeo dentro del lienzo (para colocar subtítulos debajo sin tapar la imagen). */
export function contentBand(info: MediaInfo, mode: ReframeMode, zoom: number, t: RenderTarget) {
  if (mode === "recorte_centro") return { top: 0, bottom: t.height };
  const h = Math.min(t.height, (t.width * zoom * info.displayHeight) / Math.max(1, info.displayWidth));
  return { top: (t.height - h) / 2, bottom: (t.height + h) / 2 };
}

export interface SegmentSpec {
  src: string;
  sha: string;
  info: MediaInfo;
  start: number;
  end: number;
  zoom: number;
  mode: ReframeMode;
}

/** Duración ajustada a un número entero de fotogramas para que audio y vídeo no se desfasen al concatenar. */
export function frameAligned(dur: number, fps: number) {
  return Math.max(1, Math.round(dur * fps)) / fps;
}

/**
 * Renderiza un fragmento normalizado (resolución, fps, audio estéreo 48 kHz) con caché:
 * si el mismo corte ya se procesó, se reutiliza sin volver a codificar.
 */
export async function renderSegment(s: SegmentSpec, t: RenderTarget): Promise<{ file: string; duration: number; cached: boolean }> {
  const dur = frameAligned(s.end - s.start, t.fps);
  const frames = Math.round(dur * t.fps);
  const key = crypto.createHash("sha1").update(JSON.stringify([s.sha, s.start.toFixed(3), dur.toFixed(4), s.zoom, s.mode, t.width, t.height, t.fps, 3])).digest("hex");
  const dir = path.join(paths.cache, "segments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.mkv`);
  if (fs.existsSync(file)) return { file, duration: dur, cached: true };
  const fadeOut = Math.max(0, dur - 0.03).toFixed(3);
  const audio = `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,afade=t=in:d=0.02,afade=t=out:st=${fadeOut}:d=0.03,apad,atrim=0:${dur.toFixed(4)},asetpts=N/SR/TB`;
  const args = ["-ss", s.start.toFixed(3), "-t", (dur + 0.5).toFixed(3), "-i", s.src];
  let fc = videoFilter(s.mode, s.zoom, t);
  if (s.info.hasAudio) fc += `;[0:a]${audio}[a]`;
  else {
    args.push("-f", "lavfi", "-t", dur.toFixed(4), "-i", "anullsrc=r=48000:cl=stereo");
    fc += `;[1:a]${audio}[a]`;
  }
  const tmp = file.replace(/\.mkv$/, ".tmp.mkv");
  await ffmpeg([
    ...args,
    "-filter_complex", fc,
    "-map", "[v]", "-map", "[a]",
    "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", String(t.fps * 2),
    "-c:a", "pcm_s16le",
    "-t", dur.toFixed(4),
    tmp,
  ]);
  fs.renameSync(tmp, file);
  return { file, duration: dur, cached: false };
}

export interface FinalAssembly {
  segments: string[];
  duration: number;
  assFile: string | null;
  voiceWav: string | null;
  music: { file: string; volumeDb: number } | null;
  logo: string | null;
  out: string;
  target: RenderTarget;
  fontsDir?: string;
  onProgress?: (fraction: number) => void;
}

const QUALITY = { borrador: { preset: "veryfast", crf: 23 }, normal: { preset: "medium", crf: 20 }, alta: { preset: "slow", crf: 18 } };

const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

export async function assembleFinal(a: FinalAssembly) {
  const work = path.dirname(a.out);
  const list = path.join(work, "concat.txt");
  fs.writeFileSync(list, a.segments.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const D = a.duration;
  const args = ["-f", "concat", "-safe", "0", "-i", list];
  let idx = 1;
  const parts: string[] = [];
  let speech = "[0:a]";
  if (a.voiceWav) {
    args.push("-i", a.voiceWav);
    const vi = idx++;
    parts.push(`[${vi}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo][vokey]`);
    // El audio original baja automáticamente mientras suena la voz en off.
    parts.push(`[0:a][vokey]sidechaincompress=threshold=0.02:ratio=6:attack=15:release=350[origd]`);
    parts.push(`[origd][vo]amix=inputs=2:duration=first:normalize=0[speech]`);
    speech = "[speech]";
  }
  let mix = speech;
  if (a.music) {
    args.push("-stream_loop", "-1", "-t", D.toFixed(3), "-i", a.music.file);
    const mi = idx++;
    parts.push(`[${mi}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${D.toFixed(3)},volume=${a.music.volumeDb}dB,afade=t=in:d=1,afade=t=out:st=${Math.max(0, D - 1.8).toFixed(3)}:d=1.8[mus]`);
    parts.push(`${speech}asplit=2[sp][spkey]`);
    // La música se reduce cuando hay voz (ducking) para no tapar nunca la explicación.
    parts.push(`[mus][spkey]sidechaincompress=threshold=0.015:ratio=10:attack=25:release=450[musd]`);
    parts.push(`[sp][musd]amix=inputs=2:duration=first:normalize=0[mix]`);
    mix = "[mix]";
  }
  // Normalización de sonoridad para redes (−14 LUFS) con control de picos.
  parts.push(`${mix}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`);
  let v = "[0:v]";
  if (a.assFile) {
    const fonts = a.fontsDir ? `:fontsdir='${filterPath(a.fontsDir)}'` : "";
    parts.push(`${v}ass='${filterPath(a.assFile)}'${fonts}[vs]`);
    v = "[vs]";
  }
  if (a.logo) {
    args.push("-i", a.logo);
    const li = idx++;
    const lw = Math.round(a.target.width * 0.16);
    parts.push(`[${li}:v]scale=${lw}:-1,format=rgba,colorchannelmixer=aa=0.85[logo]`);
    parts.push(`${v}[logo]overlay=W-w-${Math.round(a.target.width * 0.05)}:${Math.round(a.target.height * 0.06)}:eof_action=repeat[vl]`);
    v = "[vl]";
  }
  parts.push(`${v}format=yuv420p[vout]`);
  const q = QUALITY[a.target.quality];
  const tmp = a.out.replace(/\.mp4$/, ".tmp.mp4");
  await ffmpeg(
    [
      ...args,
      "-filter_complex", parts.join(";"),
      "-map", "[vout]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", q.preset, "-crf", String(q.crf), "-profile:v", "high", "-level:v", a.target.height > 1920 ? "5.1" : "4.2",
      "-pix_fmt", "yuv420p", "-r", String(a.target.fps), "-g", String(a.target.fps * 2),
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      "-movflags", "+faststart",
      "-t", D.toFixed(3),
      tmp,
    ],
    {
      onStderr: (chunk) => {
        const m = chunk.match(/time=(\d+):(\d+):([\d.]+)/);
        if (m && a.onProgress) a.onProgress(Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / D));
      },
    },
  );
  fs.renameSync(tmp, a.out);
}

/** Portada vertical: fotograma limpio del gancho (sin subtítulos) con la frase de portada. */
export async function renderCover(segmentFile: string, at: number, coverAss: string | null, out: string, fontsDir?: string) {
  const vf = coverAss ? `ass='${filterPath(coverAss)}'${fontsDir ? `:fontsdir='${filterPath(fontsDir)}'` : ""}` : "null";
  await ffmpeg(["-ss", Math.max(0, at).toFixed(3), "-i", segmentFile, "-frames:v", "1", "-vf", vf, "-q:v", "2", out]);
}
