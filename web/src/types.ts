export interface Profile {
  cutIntensity: "suave" | "equilibrada" | "dinamica";
  subtitleStyle: "limpio" | "dinamico" | "almantec" | "discreto" | "ninguno";
  highlightKeywords: boolean;
  voiceover: { mode: "auto" | "ninguna" | "siempre"; voice: "femenina" | "masculina"; speed: number; style: "informativo" | "dinamico" | "comercial" };
  music: { enabled: boolean; track?: string; volumeDb: number };
  zoom: "ninguno" | "moderado";
  targetDuration: number;
  hookStyle: "auto" | "resultado" | "antes_despues" | "problema_solucion" | "pregunta" | "demostracion";
  cta: string;
  reframe: "auto" | "fondo_desenfocado" | "recorte_centro";
  objective: string;
  processing: "economico" | "equilibrado" | "premium";
  hookText: boolean;
  export: { width: number; height: number; fps: "origen" | number; quality: "borrador" | "normal" | "alta" };
}

export interface ProfileRow { id: string; name: string; description: string; builtin: boolean; data: Profile; isDefault: boolean }

export interface Asset { id: string; kind: string; name: string; size: number; duration: number | null; width: number | null; height: number | null; hasThumb: boolean; warnings: string[]; missing: boolean }

export interface Stage { id: string; label: string; what: string; mayUseExternal: boolean; mayCost: boolean; status: string; message: string | null; provider: string | null; costUsd: number | null; costKnown: boolean; detail: { help?: string; log?: string; fraction?: number; done?: number; total?: number } | null }

export interface Job { id: string; type: string; status: string; error: string | null; versionId: string | null; stages: Stage[]; createdAt: string }

export interface VersionSummary { id: string; n: number; label: string; createdAt: string; hasVideo: boolean; hasCover: boolean; qcPassed: boolean | null; duration: number | null; aiUsed: boolean }

export interface ProjectDetail {
  id: string; name: string; status: string; error: string | null; profileId: string | null; options: { profile?: Partial<Profile> }; acceptedVersion: string | null;
  createdAt: string; updatedAt: string; effectiveProfile: Profile; assets: Asset[]; versions: VersionSummary[]; job: Job | null;
}

export interface ProjectRow { id: string; name: string; status: string; error: string | null; createdAt: string; updatedAt: string; clips: number; hasThumb: boolean; lastVersionId: string | null; accepted: boolean; lastJobId: string | null }

export interface Unit { id: string; assetId: string; clipName: string; start: number; end: number; kind: "voz" | "accion"; text: string; description: string; role: string; include: boolean; reason: string; scores: { interest: number; quality: number; relevance: number } }
export interface Removed { id: string; clipName: string; start: number; end: number; kind: string; reason: string; text?: string }
export interface Plan {
  intensity: string; objective: string; topic: string; audience: string;
  hook: { unitId: string; type: string; text: string; teaser: boolean; candidates: { unitId: string; type: string; total: number; why: string; breakdown: Record<string, number> }[] } | null;
  units: Unit[]; removed: Removed[]; timeline: { key: string; unitId: string; start: number; end: number; role: string; teaser?: boolean }[];
  voiceover: { source: string; lines: { text: string }[] } | null; warnings: string[]; changes: string[];
  ai: { used: boolean; model?: string; costUsd?: number | null; note?: string };
  overrides?: { include: string[]; exclude: string[] };
}
export interface Pack { titles: string[]; description: string; hashtags: { tag: string; why: string }[]; cta: string; coverText: string; hookSummary: string; source: "ia" | "plantilla" }
export interface Qc { passed: boolean; checks: { id: string; label: string; ok: boolean; severity: string; detail: string }[]; measured: { duration: number; width: number; height: number; loudnessLufs?: number } }
export interface Caption { start: number; end: number; words: { w: string; start: number; end: number }[]; text?: string }
export interface VersionDetail extends VersionSummary { projectId: string; plan: Plan; pack: Pack; qc: Qc | null; captions: { captions: Caption[]; problems: string[] } | null; stages: Stage[] | null }

export interface ProviderStatus { id: string; label: string; kind: string; external: boolean; ready: boolean; missing?: string; costNote: string; verified: boolean }

export const LABELS = {
  intensity: { suave: "Suave", equilibrada: "Equilibrada", dinamica: "Dinámica" },
  subtitle: { almantec: "Tecnológico AlmanTec", limpio: "Limpio y minimalista", dinamico: "Dinámico con palabras resaltadas", discreto: "Profesional y discreto", ninguno: "Sin subtítulos" },
  objective: { auto: "Automático según los clips", alcance: "Conseguir alcance", retencion: "Retener espectadores", mostrar_reparacion: "Mostrar una reparación", demostrar_experiencia: "Demostrar experiencia", transformacion: "Enseñar una transformación", confianza: "Generar confianza", consultas: "Conseguir consultas", promocion: "Promocionar un servicio", visitas: "Dirigir visitas al negocio" },
  hook: { auto: "Automático", resultado: "Resultado primero", antes_despues: "Antes y después", problema_solucion: "Problema y solución", pregunta: "Pregunta directa", demostracion: "Demostración visual" },
  processing: { economico: "Económico", equilibrado: "Equilibrado", premium: "Premium" },
  voiceMode: { auto: "Solo si aporta valor", ninguna: "Sin voz en off", siempre: "Siempre que haya guion" },
  reframe: { auto: "Automático (sin cortar el trabajo)", fondo_desenfocado: "Encajar con fondo desenfocado", recorte_centro: "Recortar al centro" },
  status: { draft: "Borrador", queued: "En cola", processing: "Procesando", done: "Terminado", failed: "Con errores" },
} as const;
