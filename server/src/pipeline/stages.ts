export const STAGES = [
  { id: "preparacion", label: "Preparación", what: "Comprueba los archivos, formatos y clips repetidos", external: false, cost: false },
  { id: "analisis_audio", label: "Análisis de audio", what: "Detecta voz, silencios y sonidos de trabajo", external: false, cost: false },
  { id: "transcripcion", label: "Transcripción", what: "Convierte la voz en texto para subtítulos y análisis", external: false, cost: false },
  { id: "analisis_visual", label: "Análisis visual", what: "Mide movimiento, cambios de plano, brillo y nitidez", external: false, cost: false },
  { id: "plan", label: "Plan de edición", what: "Elige gancho, fragmentos y orden; elimina pausas y repeticiones", external: true, cost: true },
  { id: "voz", label: "Voz en off", what: "Genera la narración solo si aporta valor y hay guion", external: true, cost: true },
  { id: "subtitulos", label: "Subtítulos", what: "Crea subtítulos sincronizados en zona segura", external: false, cost: false },
  { id: "render", label: "Montaje y exportación", what: "Corta, reencuadra a 9:16, mezcla audio y exporta MP4", external: false, cost: false },
  { id: "control_calidad", label: "Control de calidad", what: "Reproduce el archivo completo y verifica audio, imagen y sincronía", external: false, cost: false },
  { id: "entrega", label: "Portada y pack", what: "Crea portada, textos de publicación y guarda la versión", external: true, cost: true },
] as const;

export type StageId = (typeof STAGES)[number]["id"];
