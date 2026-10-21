import { getSetting, setSetting } from "./db.js";
import { z } from "zod";

export const brandSchema = z.object({
  name: z.string().max(80).default("AlmanTec"),
  services: z.array(z.string().max(80)).max(30).default([]),
  location: z.string().max(120).default(""),
  showLocation: z.boolean().default(false),
  web: z.string().max(200).default(""),
  instagram: z.string().max(100).default(""),
  tiktok: z.string().max(100).default(""),
  youtube: z.string().max(100).default(""),
  contact: z.string().max(160).default(""),
  ctas: z.array(z.string().max(160)).max(10).default([]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#22D3EE"),
  logo: z.string().optional(),
  showLogo: z.boolean().default(true),
  /** Productos, modelos y términos que deben escribirse correctamente y resaltarse. */
  keywords: z.array(z.string().max(60)).max(100).default([]),
  /** Correcciones de transcripción: «ifon» → «iPhone». */
  corrections: z.record(z.string(), z.string()).default({}),
  hashtags: z.array(z.string().max(60)).max(20).default([]),
});

export type Brand = z.infer<typeof brandSchema>;

export const getBrand = (): Brand => brandSchema.parse(getSetting("brand", {}));
export const setBrand = (b: Brand) => setSetting("brand", brandSchema.parse(b));

/** Llamada a la acción configurada: nunca se inventa un dato de contacto. */
export function brandCta(b: Brand, profileCta: string) {
  if (profileCta.trim()) return profileCta.trim();
  if (b.ctas[0]) return b.ctas[0];
  if (b.contact) return `Pide presupuesto: ${b.contact}`;
  if (b.web) return `Más información en ${b.web}`;
  return "";
}
