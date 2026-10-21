import fs from "node:fs";
import path from "node:path";
import { ffmpeg } from "../lib/ffmpeg.js";
import { estimateWordTimes } from "../providers/local-speech.js";
import type { VoiceSynth, Word } from "../providers/types.js";
import type { TimelineItem, VoiceLine } from "./types.js";

export interface PlacedLine {
  text: string;
  start: number;
  end: number;
  file: string;
  words: Word[];
}

/** Divide un guion en frases cortas aptas para locución. */
export function splitScript(text: string): string[] {
  return text
    .replace(/\r/g, "")
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && !s.startsWith("#"));
}

export function timelineOffsets(items: TimelineItem[], fps: number) {
  let t = 0;
  const map = new Map<string, { start: number; end: number }>();
  for (const it of items) {
    const d = Math.max(1, Math.round((it.end - it.start) * fps)) / fps;
    map.set(it.key, { start: t, end: t + d });
    t += d;
  }
  return { map, total: t };
}

/**
 * Sintetiza la voz en off y la coloca en la línea temporal sin solapes.
 * Si no cabe, acelera ligeramente y, como último recurso, recorta las últimas frases (con aviso).
 */
export async function synthesizeVoiceover(
  lines: VoiceLine[],
  items: TimelineItem[],
  fps: number,
  synth: VoiceSynth,
  opts: { voice: "femenina" | "masculina"; speed: number; workDir: string },
): Promise<{ placed: PlacedLine[]; wav: string | null; warnings: string[]; characters: number }> {
  const warnings: string[] = [];
  const { map, total } = timelineOffsets(items, fps);
  const dir = path.join(opts.workDir, "voz");
  fs.mkdirSync(dir, { recursive: true });
  let speed = opts.speed;
  let placed: PlacedLine[] = [];
  let characters = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    placed = [];
    characters = 0;
    let cursor = 0.25;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const file = path.join(dir, `l${i}_${speed.toFixed(2)}.wav`);
      const r = await synth.synthesize(l.text, { voice: opts.voice, speed, out: file });
      characters += r.characters;
      const anchor = l.timelineKey ? map.get(l.timelineKey)?.start ?? cursor : cursor;
      const start = Math.max(cursor, anchor + 0.15);
      placed.push({ text: l.text, start, end: start + r.duration, file, words: estimateWordTimes(l.text, start, start + r.duration) });
      cursor = start + r.duration + 0.2;
    }
    const last = placed[placed.length - 1];
    if (!last || last.end <= total - 0.3) break;
    if (speed < 1.25) {
      speed = Math.min(1.25, speed * ((last.end + 0.3) / total) + 0.02);
      continue;
    }
    break;
  }
  const kept = placed.filter((p) => p.end <= total - 0.1);
  if (kept.length < placed.length) warnings.push(`La voz en off no cabía completa: se omitieron ${placed.length - kept.length} frase(s) finales.`);
  if (!kept.length) return { placed: [], wav: null, warnings, characters };
  const wav = path.join(dir, "voz.wav");
  const args: string[] = [];
  const filters: string[] = [];
  kept.forEach((p, i) => {
    args.push("-i", p.file);
    const ms = Math.round(p.start * 1000);
    filters.push(`[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}:all=1[d${i}]`);
  });
  filters.push(`${kept.map((_, i) => `[d${i}]`).join("")}amix=inputs=${kept.length}:duration=longest:normalize=0,apad,atrim=0:${total.toFixed(3)}[out]`);
  await ffmpeg([...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ac", "1", "-ar", "48000", wav]);
  return { placed: kept, wav, warnings, characters };
}
