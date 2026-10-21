import { getSetting } from "../db.js";
import { anthropicStatus } from "./anthropic.js";
import { ElevenLabsVoice } from "./elevenlabs.js";
import { LocalPiper, LocalWhisper, vadStatus } from "./local-speech.js";
import type { ProviderStatus, Transcriber, VoiceSynth } from "./types.js";

const whisperSmall = new LocalWhisper("small");
const whisperBase = new LocalWhisper("base");
const piper = new LocalPiper();
const eleven = new ElevenLabsVoice();

export interface ProviderPrefs {
  voice: "auto" | "piper-local" | "elevenlabs";
  /** Usar IA de lenguaje (Claude) en el modo equilibrado. */
  llmInBalanced: boolean;
  /** Modelos de Claude por modo. */
  llmModelBalanced: string;
  llmModelPremium: string;
}

export const getProviderPrefs = () =>
  getSetting<ProviderPrefs>("providerPrefs", { voice: "auto", llmInBalanced: true, llmModelBalanced: "claude-opus-5-5", llmModelPremium: "claude-opus-5-5" });

export function transcriberFor(mode: "economico" | "equilibrado" | "premium"): Transcriber | null {
  const order = mode === "economico" ? [whisperBase, whisperSmall] : [whisperSmall, whisperBase];
  return order.find((t) => t.status().ready) ?? null;
}

export function voiceSynth(): VoiceSynth | null {
  const pref = getProviderPrefs().voice;
  if (pref === "elevenlabs") return eleven.status().ready ? eleven : null;
  if (pref === "piper-local") return piper.status().ready ? piper : null;
  if (eleven.status().ready) return eleven;
  return piper.status().ready ? piper : null;
}

export function llmFor(mode: "economico" | "equilibrado" | "premium"): { model: string; effort: "low" | "medium" | "high"; maxFrames: number } | null {
  if (!anthropicStatus().ready || mode === "economico") return null;
  const prefs = getProviderPrefs();
  if (mode === "equilibrado") return prefs.llmInBalanced ? { model: prefs.llmModelBalanced, effort: "medium", maxFrames: 8 } : null;
  return { model: prefs.llmModelPremium, effort: "high", maxFrames: 20 };
}

export function allProviderStatus(): ProviderStatus[] {
  return [vadStatus(), whisperSmall.status(), whisperBase.status(), piper.status(), eleven.status(), anthropicStatus()];
}
