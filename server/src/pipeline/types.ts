import type { MediaInfo } from "../lib/ffmpeg.js";
import type { TranscriptSegment } from "../providers/types.js";
import type { AudioAnalysis, VisualAnalysis } from "./analyze.js";

export interface ClipInput {
  assetId: string;
  name: string;
  src: string;
  sha: string;
  position: number;
  info: MediaInfo;
  audio: AudioAnalysis;
  visual: VisualAnalysis;
  transcript: TranscriptSegment[];
}

export type NarrativeRole = "gancho" | "contexto" | "desarrollo" | "prueba" | "cierre";

export interface Unit {
  id: string;
  assetId: string;
  clipName: string;
  start: number;
  end: number;
  kind: "voz" | "accion";
  text: string;
  description: string;
  role: NarrativeRole;
  include: boolean;
  reason: string;
  /** Posición relativa en todo el material (0 = inicio del primer clip, 1 = final del último). */
  relPos: number;
  scores: { interest: number; quality: number; relevance: number };
  stats: { motion: number; brightness: number; blur: number; energyDb: number; words: number; dark: boolean; blurry: boolean };
}

export type RemovedKind = "silencio" | "pausa" | "espera" | "repeticion" | "muletilla" | "calidad" | "negro" | "duracion" | "manual" | "ia";

export interface Removed {
  id: string;
  assetId: string;
  clipName: string;
  start: number;
  end: number;
  kind: RemovedKind;
  reason: string;
  text?: string;
}

export interface HookCandidate {
  unitId: string;
  type: string;
  start: number;
  end: number;
  teaser: boolean;
  total: number;
  breakdown: { impacto: number; claridad: number; curiosidad: number; relevancia: number; transformacion: number; relacion: number };
  why: string;
}

export interface TimelineItem {
  key: string;
  unitId: string;
  assetId: string;
  start: number;
  end: number;
  role: NarrativeRole;
  /** Factor de acercamiento moderado (1 = sin zoom). */
  zoom: number;
  teaser?: boolean;
}

export interface VoiceLine {
  text: string;
  /** Elemento de la línea temporal sobre el que debe sonar. */
  timelineKey?: string;
}

export interface PublishDraft {
  titles: string[];
  description: string;
  hashtags: { tag: string; why: string }[];
  cta: string;
  coverText: string;
  hookSummary: string;
}

export interface EditPlan {
  version: 1;
  createdAt: string;
  intensity: "suave" | "equilibrada" | "dinamica";
  objective: string;
  topic: string;
  audience: string;
  hook: { unitId: string; type: string; text: string; teaser: boolean; candidates: HookCandidate[] } | null;
  units: Unit[];
  removed: Removed[];
  timeline: TimelineItem[];
  voiceover: { source: "guion_usuario" | "ia" | "cta"; lines: VoiceLine[] } | null;
  warnings: string[];
  changes: string[];
  ai: { used: boolean; provider?: string; model?: string; costUsd?: number | null; note?: string };
  publish?: PublishDraft;
  /** Correcciones manuales del usuario: unidades forzadas a incluir o excluir. */
  overrides?: { include: string[]; exclude: string[] };
}
