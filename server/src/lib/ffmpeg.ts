import { spawn } from "node:child_process";
import { config } from "../config.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandError extends Error {
  constructor(message: string, public stderrTail: string) {
    super(message);
  }
}

/** Ejecuta un binario sin shell (los argumentos nunca se interpretan). */
export function run(cmd: string, args: string[], opts: { onStderr?: (chunk: string) => void; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
      opts.onStderr?.(s);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function ffmpeg(args: string[], opts: { onStderr?: (chunk: string) => void; allowFail?: boolean } = {}) {
  const base = ["-hide_banner", "-nostdin", "-y"];
  if (config.threads > 0) base.push("-threads", String(config.threads));
  const r = await run("ffmpeg", [...base, ...args], opts);
  if (r.code !== 0 && !opts.allowFail) {
    const tail = r.stderr.split("\n").slice(-15).join("\n");
    throw new CommandError(`FFmpeg terminó con código ${r.code}`, tail);
  }
  return r;
}

export interface ProbeStream {
  index: number;
  codec_type: "video" | "audio" | "subtitle" | "data";
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  pix_fmt?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

export interface ProbeResult {
  format: { duration?: string; format_name?: string; bit_rate?: string; size?: string };
  streams: ProbeStream[];
}

export async function ffprobe(file: string): Promise<ProbeResult> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  if (r.code !== 0) throw new CommandError("No se pudo leer el archivo multimedia (formato no válido o dañado)", r.stderr.slice(-2000));
  return JSON.parse(r.stdout) as ProbeResult;
}

export function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [a, b] = rate.split("/").map(Number);
  if (!b) return a || 0;
  return a / b;
}

export interface MediaInfo {
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width: number;
  height: number;
  /** Dimensiones tras aplicar la rotación de los metadatos (móviles). */
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  fps: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  formatName?: string;
}

export function mediaInfo(p: ProbeResult): MediaInfo {
  const v = p.streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const a = p.streams.find((s) => s.codec_type === "audio");
  let rotation = 0;
  if (v) {
    const sd = v.side_data_list?.find((x) => typeof x.rotation === "number");
    rotation = sd?.rotation ?? Number(v.tags?.rotate ?? 0);
    rotation = ((Math.round(rotation) % 360) + 360) % 360;
  }
  const w = v?.width ?? 0;
  const h = v?.height ?? 0;
  const swap = rotation === 90 || rotation === 270;
  return {
    duration: Number(p.format.duration ?? v?.duration ?? a?.duration ?? 0),
    hasVideo: !!v,
    hasAudio: !!a,
    width: w,
    height: h,
    displayWidth: swap ? h : w,
    displayHeight: swap ? w : h,
    rotation,
    fps: parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate),
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : undefined,
    formatName: p.format.format_name,
  };
}
