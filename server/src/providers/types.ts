export interface Word {
  w: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words: Word[];
  /** "segmento": tiempos de palabra estimados dentro de un tramo de voz detectado. */
  timing: "palabra" | "segmento";
}

export interface ProviderStatus {
  id: string;
  label: string;
  kind: "transcripcion" | "voz" | "llm" | "vision" | "vad";
  /** true si el contenido sale del servidor hacia un tercero. */
  external: boolean;
  ready: boolean;
  /** Qué falta exactamente para poder usarlo. */
  missing?: string;
  costNote: string;
  verified: boolean;
}

export interface SpeechRegion {
  start: number;
  end: number;
}

export interface Transcriber {
  id: string;
  status(): ProviderStatus;
  transcribe(wav16kMono: string, regions: SpeechRegion[], opts: { language: string; onProgress?: (done: number, total: number) => void }): Promise<TranscriptSegment[]>;
}

export interface VoiceSynth {
  id: string;
  status(): ProviderStatus;
  voices(): { id: string; label: string; gender: "femenina" | "masculina" }[];
  /** Escribe un WAV y devuelve la duración en segundos y las unidades facturables (caracteres). */
  synthesize(text: string, opts: { voice: "femenina" | "masculina"; speed: number; out: string }): Promise<{ duration: number; characters: number }>;
}

export interface LlmImage {
  /** JPEG en base64. */
  data: string;
  label: string;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}
