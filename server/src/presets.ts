import { z } from "zod";
import { db, now } from "./db.js";

export const CUT_INTENSITIES = ["suave", "equilibrada", "dinamica"] as const;
export const SUBTITLE_STYLES = ["limpio", "dinamico", "almantec", "discreto", "ninguno"] as const;
export const OBJECTIVES = [
  "auto", "alcance", "retencion", "mostrar_reparacion", "demostrar_experiencia", "transformacion",
  "confianza", "consultas", "promocion", "visitas",
] as const;
export const HOOK_STYLES = ["auto", "resultado", "antes_despues", "problema_solucion", "pregunta", "demostracion"] as const;
export const PROCESSING_MODES = ["economico", "equilibrado", "premium"] as const;

export const profileSchema = z.object({
  cutIntensity: z.enum(CUT_INTENSITIES).default("equilibrada"),
  subtitleStyle: z.enum(SUBTITLE_STYLES).default("almantec"),
  highlightKeywords: z.boolean().default(true),
  voiceover: z
    .object({
      mode: z.enum(["auto", "ninguna", "siempre"]).default("auto"),
      voice: z.enum(["femenina", "masculina"]).default("femenina"),
      speed: z.number().min(0.7).max(1.4).default(1.05),
      style: z.enum(["informativo", "dinamico", "comercial"]).default("dinamico"),
    })
    .default({ mode: "auto", voice: "femenina", speed: 1.05, style: "dinamico" }),
  music: z
    .object({ enabled: z.boolean().default(true), track: z.string().optional(), volumeDb: z.number().min(-40).max(0).default(-20) })
    .default({ enabled: true, volumeDb: -20 }),
  zoom: z.enum(["ninguno", "moderado"]).default("moderado"),
  /** Duración objetivo en segundos. 0 = automática (todo lo útil, máximo 90 s). */
  targetDuration: z.number().min(0).max(600).default(45),
  hookStyle: z.enum(HOOK_STYLES).default("auto"),
  cta: z.string().max(200).default(""),
  reframe: z.enum(["auto", "fondo_desenfocado", "recorte_centro"]).default("auto"),
  objective: z.enum(OBJECTIVES).default("auto"),
  processing: z.enum(PROCESSING_MODES).default("equilibrado"),
  hookText: z.boolean().default(true),
  export: z
    .object({
      width: z.number().int().min(360).max(2160).default(1080),
      height: z.number().int().min(360).max(3840).default(1920),
      fps: z.union([z.literal("origen"), z.number().int().min(24).max(60)]).default("origen"),
      quality: z.enum(["borrador", "normal", "alta"]).default("normal"),
    })
    .default({ width: 1080, height: 1920, fps: "origen", quality: "normal" }),
});

export type EditProfile = z.infer<typeof profileSchema>;

export const defaultProfile = (): EditProfile => profileSchema.parse({});

const p = (o: Partial<z.input<typeof profileSchema>>) => profileSchema.parse(o);

export const BUILTIN_PROFILES: { id: string; name: string; description: string; data: EditProfile }[] = [
  { id: "almantec-viral", name: "AlmanTec Viral", description: "Equilibrado, dinámico y profesional. Perfil por defecto.", data: p({}) },
  { id: "paso-a-paso", name: "Reparación paso a paso", description: "Conserva el proceso completo con cortes suaves y explicación.", data: p({ cutIntensity: "suave", targetDuration: 75, objective: "mostrar_reparacion", subtitleStyle: "limpio", voiceover: { mode: "auto", voice: "femenina", speed: 1, style: "informativo" } }) },
  { id: "antes-despues", name: "Antes y después", description: "Abre con el resultado final y muestra la transformación.", data: p({ hookStyle: "antes_despues", objective: "transformacion", targetDuration: 30 }) },
  { id: "satisfactoria", name: "Reparación satisfactoria", description: "Prioriza sonido original y planos limpios, sin voz en off.", data: p({ voiceover: { mode: "ninguna", voice: "femenina", speed: 1, style: "dinamico" }, subtitleStyle: "discreto", music: { enabled: true, volumeDb: -26 }, hookStyle: "demostracion" }) },
  { id: "explicacion-tecnica", name: "Explicación técnica", description: "Ritmo pausado, subtítulos claros y respeto por las explicaciones.", data: p({ cutIntensity: "suave", subtitleStyle: "limpio", targetDuration: 90, objective: "demostrar_experiencia", zoom: "ninguno", voiceover: { mode: "auto", voice: "masculina", speed: 1, style: "informativo" } }) },
  { id: "promocion", name: "Promoción comercial", description: "Cierre con llamada a la acción de la marca.", data: p({ objective: "promocion", targetDuration: 30, voiceover: { mode: "auto", voice: "femenina", speed: 1.05, style: "comercial" } }) },
  { id: "voz-en-off", name: "Vídeo con voz en off", description: "Genera narración siempre que haya guion disponible.", data: p({ voiceover: { mode: "siempre", voice: "femenina", speed: 1.05, style: "dinamico" }, music: { enabled: true, volumeDb: -24 } }) },
  { id: "sonido-original", name: "Vídeo con sonido original", description: "Sin voz artificial ni música: solo el audio grabado.", data: p({ voiceover: { mode: "ninguna", voice: "femenina", speed: 1, style: "dinamico" }, music: { enabled: false, volumeDb: -20 } }) },
  { id: "rapido-retencion", name: "Vídeo rápido para retención", description: "Cortes dinámicos y duración corta.", data: p({ cutIntensity: "dinamica", targetDuration: 20, objective: "retencion", subtitleStyle: "dinamico" }) },
  { id: "limpio-profesional", name: "Vídeo limpio y profesional", description: "Sin zooms ni efectos, subtítulos discretos.", data: p({ zoom: "ninguno", subtitleStyle: "discreto", music: { enabled: true, volumeDb: -26 } }) },
];

export function seedProfiles() {
  const ins = db.prepare(
    "INSERT INTO profiles (id, name, description, builtin, data, created_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, data=CASE WHEN profiles.builtin=1 THEN excluded.data ELSE profiles.data END",
  );
  for (const b of BUILTIN_PROFILES) ins.run(b.id, b.name, b.description, JSON.stringify(b.data), now());
}
