import { ffmpeg, ffprobe, mediaInfo } from "../lib/ffmpeg.js";

export interface QcCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "error" | "aviso";
  detail: string;
}

export interface QcReport {
  passed: boolean;
  checks: QcCheck[];
  measured: { duration: number; width: number; height: number; fps: number; videoCodec?: string; audioCodec?: string; loudnessLufs?: number; truePeakDb?: number };
}

/**
 * Control de calidad del archivo final: se decodifica completo (prueba real de reproducción),
 * se miden sonoridad, pantallas negras y silencios, y se compara con lo planificado.
 */
export async function qualityCheck(file: string, expected: { duration: number; width: number; height: number; fps: number; allowSilence: boolean; subtitleProblems: string[] }): Promise<QcReport> {
  const checks: QcCheck[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, severity: QcCheck["severity"] = "error") => checks.push({ id, label, ok, detail, severity });

  const probe = await ffprobe(file);
  const info = mediaInfo(probe);
  const v = probe.streams.find((s) => s.codec_type === "video");
  const a = probe.streams.find((s) => s.codec_type === "audio");

  add("formato", "Formato MP4 con H.264 y AAC", !!v && v.codec_name === "h264" && a?.codec_name === "aac" && /mp4/.test(info.formatName ?? ""), `Vídeo: ${v?.codec_name ?? "no"} · Audio: ${a?.codec_name ?? "no"} · Contenedor: ${info.formatName}`);
  add("resolucion", "Resolución esperada", info.width === expected.width && info.height === expected.height, `${info.width}×${info.height} (esperado ${expected.width}×${expected.height})`);
  add("pixfmt", "Compatibilidad de color (yuv420p)", v?.pix_fmt === "yuv420p", v?.pix_fmt ?? "desconocido");
  const durDiff = Math.abs(info.duration - expected.duration);
  add("duracion", "Duración coherente con el plan", durDiff < 0.6, `${info.duration.toFixed(2)} s (plan: ${expected.duration.toFixed(2)} s)`);
  add("duracion_razonable", "Duración razonable para vídeo corto", info.duration >= 3 && info.duration <= 180, `${info.duration.toFixed(1)} s`, "aviso");
  const vDur = Number(v?.duration ?? info.duration);
  const aDur = Number(a?.duration ?? 0);
  add("sincronia", "Pistas de audio y vídeo alineadas", !!a && Math.abs(vDur - aDur) < 0.15, `Vídeo ${vDur.toFixed(2)} s · Audio ${aDur.toFixed(2)} s`);

  // Decodificación completa + detección de negro, silencio y sonoridad en una pasada.
  const r = await ffmpeg(
    ["-v", "info", "-i", file, "-filter_complex", "[0:v]blackdetect=d=0.4:pix_th=0.06[vo];[0:a]silencedetect=noise=-45dB:d=1.5,ebur128=peak=true[ao]", "-map", "[vo]", "-map", "[ao]", "-f", "null", "-"],
    { allowFail: true },
  );
  const decodeErrors = r.stderr.split("\n").filter((l) => /error|corrupt|invalid/i.test(l) && !/silencedetect|blackdetect/.test(l));
  add("reproduccion", "El vídeo se decodifica de principio a fin", r.code === 0 && decodeErrors.length === 0, r.code === 0 ? (decodeErrors.length ? `${decodeErrors.length} errores de decodificación` : "Sin errores") : `FFmpeg devolvió ${r.code}`);

  const blacks = [...r.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ s: Number(m[1]), e: Number(m[2]) }));
  add("negro", "Sin pantallas negras inesperadas", blacks.length === 0, blacks.length ? blacks.map((b) => `${b.s.toFixed(1)}–${b.e.toFixed(1)} s`).join(", ") : "Ninguna");

  const sil: { s: number; e: number }[] = [];
  let cur: number | null = null;
  for (const line of r.stderr.split("\n")) {
    const s = line.match(/silence_start: ([\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) cur = Number(s[1]);
    if (e && cur !== null) {
      sil.push({ s: cur, e: Number(e[1]) });
      cur = null;
    }
  }
  if (cur !== null) sil.push({ s: cur, e: info.duration });
  add(
    "silencios",
    "Sin silencios accidentales",
    expected.allowSilence || sil.length === 0,
    sil.length ? sil.map((x) => `${x.s.toFixed(1)}–${x.e.toFixed(1)} s`).join(", ") + (expected.allowSilence ? " (material sin audio: permitido)" : "") : "Ninguno",
    expected.allowSilence ? "aviso" : "error",
  );
  const lufs = [...r.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  const peak = [...r.stderr.matchAll(/Peak:\s+(-?[\d.]+|-inf) dBFS/g)].pop();
  const L = lufs ? Number(lufs[1]) : undefined;
  const P = peak && peak[1] !== "-inf" ? Number(peak[1]) : undefined;
  add("volumen", "Volumen equilibrado (≈ −14 LUFS, picos < −1 dBTP)", L !== undefined && Math.abs(L + 14) <= 2.5 && (P === undefined || P <= -0.5), `Sonoridad ${L?.toFixed(1) ?? "?"} LUFS · Pico ${P?.toFixed(1) ?? "?"} dBTP`, expected.allowSilence ? "aviso" : "error");
  add("subtitulos", "Subtítulos dentro de la zona segura", expected.subtitleProblems.length === 0, expected.subtitleProblems.length ? expected.subtitleProblems.slice(0, 3).join(" · ") : "Todas las líneas caben en el área segura", "aviso");

  return {
    passed: checks.every((c) => c.ok || c.severity === "aviso"),
    checks,
    measured: { duration: info.duration, width: info.width, height: info.height, fps: info.fps, videoCodec: v?.codec_name, audioCodec: a?.codec_name, loudnessLufs: L, truePeakDb: P },
  };
}
