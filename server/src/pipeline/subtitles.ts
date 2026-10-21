import type { Word } from "../providers/types.js";
import type { EditProfile } from "../presets.js";
import { TECH_TERMS, normalize } from "./text.js";

export interface Caption {
  start: number;
  end: number;
  words: Word[];
  /** Margen inferior en píxeles (posición segura según el encuadre del fragmento). */
  marginV: number;
  /** Texto editado manualmente (sustituye a las palabras). */
  text?: string;
}

export interface OverlayText {
  start: number;
  end: number;
  text: string;
  kind: "gancho" | "cta";
}

export interface StyleSpec {
  font: string;
  size: number;
  bold: boolean;
  upper: boolean;
  maxChars: number;
  maxLines: number;
  maxWords: number;
  outline: number;
  shadow: number;
  box: boolean;
  karaoke: boolean;
}

export const STYLE_SPECS: Record<Exclude<EditProfile["subtitleStyle"], "ninguno">, StyleSpec> = {
  limpio: { font: "Inter", size: 66, bold: true, upper: false, maxChars: 24, maxLines: 2, maxWords: 8, outline: 5, shadow: 0, box: false, karaoke: false },
  dinamico: { font: "Inter", size: 88, bold: true, upper: true, maxChars: 16, maxLines: 1, maxWords: 3, outline: 7, shadow: 2, box: false, karaoke: true },
  almantec: { font: "Inter", size: 70, bold: true, upper: false, maxChars: 22, maxLines: 2, maxWords: 7, outline: 0, shadow: 0, box: true, karaoke: false },
  discreto: { font: "Inter", size: 54, bold: false, upper: false, maxChars: 32, maxLines: 2, maxWords: 10, outline: 3, shadow: 1, box: false, karaoke: false },
};

/** Agrupa palabras en subtítulos cortos y legibles. */
export function chunkWords(words: Word[], spec: StyleSpec, marginFor: (t: number) => number): Caption[] {
  const caps: Caption[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) caps.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, marginV: marginFor(cur[0].start) });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const text = [...cur, w].map((x) => x.w).join(" ");
    const tooLong = text.length > spec.maxChars * spec.maxLines || cur.length >= spec.maxWords;
    const gap = prev && w.start - prev.end > 0.5;
    const tooSlow = cur.length && w.end - cur[0].start > 3;
    const otherZone = prev && marginFor(w.start) !== marginFor(prev.start);
    if (cur.length && (tooLong || gap || tooSlow || otherZone)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w) || (/[,;:]$/.test(w.w) && cur.length >= Math.ceil(spec.maxWords / 2))) flush();
  }
  flush();
  // Mínimo de lectura y sin solapes.
  for (let i = 0; i < caps.length; i++) {
    const next = caps[i + 1];
    caps[i].end = Math.max(caps[i].end, caps[i].start + 0.7);
    if (next && caps[i].end > next.start - 0.02) caps[i].end = Math.max(caps[i].start + 0.2, next.start - 0.02);
  }
  return caps;
}

function splitLines(text: string, maxChars: number, maxLines: number) {
  if (text.length <= maxChars || maxLines === 1) return [text];
  const words = text.split(" ");
  // Corte en el punto que deja las dos líneas más equilibradas.
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    const diff = Math.abs(a - b) + (Math.max(a, b) > maxChars ? 100 : 0);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const srtTime = (t: number) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** "#RRGGBB" → color ASS "&H00BBGGRR". */
export function assColor(hex: string, alpha = 0) {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ["00", "E5", "FF"];
  return `&H${alpha.toString(16).padStart(2, "0").toUpperCase()}${b}${g}${r}`.toUpperCase();
}

const esc = (s: string) => s.replace(/\\/g, "/").replace(/[{}]/g, "").replace(/\n/g, " ");

export function isKeyword(w: string, extra: string[]) {
  const n = normalize(w);
  if (!n) return false;
  if (/\d/.test(n)) return true;
  return TECH_TERMS.some((t) => normalize(t) === n) || extra.some((t) => normalize(t) === n);
}

export interface AssOptions {
  width: number;
  height: number;
  style: EditProfile["subtitleStyle"];
  accent: string;
  highlight: boolean;
  keywords: string[];
}

export function buildAss(captions: Caption[], overlays: OverlayText[], o: AssOptions) {
  const k = o.width / 1080;
  const spec = o.style === "ninguno" ? STYLE_SPECS.limpio : STYLE_SPECS[o.style];
  const accent = assColor(o.accent);
  const white = "&H00FFFFFF";
  const sz = Math.round(spec.size * k);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${spec.font},${sz},${white},${accent},${spec.box ? "&H38101014" : "&H00000000"},&H80000000,${spec.bold ? -1 : 0},0,0,0,100,100,0,0,${spec.box ? 3 : 1},${spec.box ? Math.round(14 * k) : Math.round(spec.outline * k)},${Math.round(spec.shadow * k)},2,${Math.round(90 * k)},${Math.round(150 * k)},${Math.round(480 * k)},1
Style: Hook,Inter,${Math.round(78 * k)},&H00101014,${white},${accent},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(18 * k)},0,8,${Math.round(80 * k)},${Math.round(80 * k)},${Math.round(250 * k)},1
Style: Cta,Inter,${Math.round(64 * k)},${white},${white},&H30101014,&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(16 * k)},0,8,${Math.round(80 * k)},${Math.round(80 * k)},${Math.round(250 * k)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines: string[] = [];
  const fmtWord = (w: string, active: boolean) => {
    const t = spec.upper ? w.toUpperCase() : w;
    if (active) return `{\\c${accent}}${esc(t)}{\\c${white}}`;
    if (o.highlight && isKeyword(w, o.keywords)) return `{\\c${accent}}${esc(t)}{\\c${white}}`;
    return esc(t);
  };
  if (o.style !== "ninguno") {
    for (const c of captions) {
      const mv = Math.round(c.marginV * k);
      if (c.text !== undefined) {
        const t = spec.upper ? c.text.toUpperCase() : c.text;
        lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,${mv},,${splitLines(esc(t), spec.maxChars, spec.maxLines).join("\\N")}`);
        continue;
      }
      if (spec.karaoke) {
        // Una línea por palabra activa: la palabra que suena se resalta con el color de acento.
        c.words.forEach((w, i) => {
          const s = i === 0 ? c.start : w.start;
          const e = i === c.words.length - 1 ? c.end : c.words[i + 1].start;
          if (e - s < 0.01) return;
          const pop = i === 0 ? "{\\fscx108\\fscy108\\t(0,90,\\fscx100\\fscy100)}" : "";
          lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Sub,,0,0,${mv},,${pop}${c.words.map((x, j) => fmtWord(x.w, j === i)).join(" ")}`);
        });
      } else {
        const text = c.words.map((x) => x.w).join(" ");
        const split = splitLines(text, spec.maxChars, spec.maxLines);
        let idx = 0;
        const rendered = split.map((line) => line.split(" ").map(() => fmtWord(c.words[idx++]?.w ?? "", false)).join(" "));
        lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,${mv},,${rendered.join("\\N")}`);
      }
    }
  }
  for (const ov of overlays) {
    const style = ov.kind === "gancho" ? "Hook" : "Cta";
    const text = splitLines(esc(ov.text), 22, 2).join("\\N");
    lines.push(`Dialogue: 1,${assTime(ov.start)},${assTime(ov.end)},${style},,0,0,0,,{\\fad(120,200)}${text}`);
  }
  return header + lines.join("\n") + "\n";
}

export function buildSrt(captions: Caption[]) {
  return captions
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text ?? c.words.map((w) => w.w).join(" ")}\n`)
    .join("\n");
}

/** Comprobación geométrica: ninguna línea se sale del área segura (estimación por ancho medio de carácter). */
export function checkSafeArea(captions: Caption[], o: AssOptions) {
  const spec = o.style === "ninguno" ? STYLE_SPECS.limpio : STYLE_SPECS[o.style];
  const k = o.width / 1080;
  const charW = spec.size * k * (spec.upper ? 0.62 : 0.52);
  const safeW = o.width - (90 + 150) * k;
  const problems: string[] = [];
  for (const c of captions) {
    const text = c.text ?? c.words.map((w) => w.w).join(" ");
    const lines = splitLines(text, spec.maxChars, spec.maxLines);
    const widest = Math.max(...lines.map((l) => l.length)) * charW;
    const top = o.height - c.marginV * k - lines.length * spec.size * k * 1.25;
    if (widest > safeW * 1.08) problems.push(`Subtítulo demasiado ancho en ${c.start.toFixed(1)} s: «${text.slice(0, 40)}»`);
    if (top < o.height * 0.15 || c.marginV * k < o.height * 0.12) problems.push(`Subtítulo fuera de la zona segura en ${c.start.toFixed(1)} s`);
  }
  return problems;
}

/** Portada: frase grande, centrada, con caja de color de acento y ajuste de línea. */
export function buildCoverAss(text: string, o: { width: number; height: number; accent: string }) {
  const k = o.width / 1080;
  // Mayúsculas salvo en marcas con mayúsculas internas (iPhone, AlmanTec).
  const upper = text.split(" ").map((w) => (/[a-z][A-Z]/.test(w) ? w : w.toUpperCase())).join(" ");
  const lines = splitLines(esc(upper), 14, 2).join("\\N");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${o.width}
PlayResY: ${o.height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cover,Inter,${Math.round(100 * k)},&H00101014,&H00FFFFFF,${assColor(o.accent)},&H00000000,-1,0,0,0,100,100,0,0,3,${Math.round(26 * k)},0,5,${Math.round(90 * k)},${Math.round(90 * k)},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:10.00,Cover,,0,0,0,,{\\pos(${Math.round(o.width / 2)},${Math.round(o.height * 0.4)})}${lines}
`;
}
