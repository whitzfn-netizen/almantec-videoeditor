import fs from "node:fs";
import { config } from "../config.js";
import { ffmpeg, ffprobe, mediaInfo } from "../lib/ffmpeg.js";
import type { ProviderStatus, VoiceSynth } from "./types.js";

const VOICE_F = process.env.ELEVENLABS_VOICE_FEMALE ?? "";
const VOICE_M = process.env.ELEVENLABS_VOICE_MALE ?? "";
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";

/** Adaptador ElevenLabs. Implementado según su API REST pública; pendiente de verificar con una clave real. */
export class ElevenLabsVoice implements VoiceSynth {
  id = "elevenlabs";
  status(): ProviderStatus {
    const missing = !config.elevenlabsApiKey
      ? "Añade ELEVENLABS_API_KEY y los ID de voz ELEVENLABS_VOICE_FEMALE / ELEVENLABS_VOICE_MALE al .env"
      : !VOICE_F && !VOICE_M ? "Faltan ELEVENLABS_VOICE_FEMALE / ELEVENLABS_VOICE_MALE en el .env" : undefined;
    return {
      id: this.id, label: "ElevenLabs (voces naturales)", kind: "voz", external: true, ready: !missing, missing, verified: false,
      costNote: "De pago por caracteres. Solo se envía el texto del guion, nunca el vídeo",
    };
  }
  voices() {
    return [
      ...(VOICE_F ? [{ id: "femenina", label: "Voz femenina configurada", gender: "femenina" as const }] : []),
      ...(VOICE_M ? [{ id: "masculina", label: "Voz masculina configurada", gender: "masculina" as const }] : []),
    ];
  }
  async synthesize(text: string, opts: { voice: "femenina" | "masculina"; speed: number; out: string }) {
    const voiceId = (opts.voice === "masculina" ? VOICE_M : VOICE_F) || VOICE_F || VOICE_M;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": config.elevenlabsApiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: MODEL, language_code: "es", voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, opts.speed)) } }),
    });
    if (!res.ok) throw new Error(`ElevenLabs respondió ${res.status}. Revisa la clave, el ID de voz y el saldo`);
    const mp3 = opts.out.replace(/\.wav$/, ".mp3");
    fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    await ffmpeg(["-i", mp3, "-ar", "48000", "-ac", "1", opts.out]);
    const info = mediaInfo(await ffprobe(opts.out));
    return { duration: info.duration, characters: text.length };
  }
}
