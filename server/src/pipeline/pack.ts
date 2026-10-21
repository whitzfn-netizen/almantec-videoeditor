import type { Brand } from "../brand.js";
import { brandCta } from "../brand.js";
import type { EditProfile } from "../presets.js";
import { detectDevices, normalize } from "./text.js";
import type { EditPlan, PublishDraft } from "./types.js";

const COMPONENTS: [RegExp, string, string][] = [
  [/pantalla|display|lcd|oled|tactil/, "pantalla", "cambiodepantalla"],
  [/bateria/, "batería", "cambiodebateria"],
  [/conector|puerto de carga|no carga/, "conector de carga", "conectordecarga"],
  [/camara/, "cámara", ""],
  [/placa|microsoldadura|soldar|soldadura/, "placa base", "microsoldadura"],
  [/agua|mojado|humedad/, "daños por líquido", ""],
  [/altavoz|microfono/, "audio", ""],
  [/cristal|tapa trasera/, "tapa / cristal", ""],
];

const tagify = (s: string) => "#" + normalize(s).replace(/\s+/g, "");

/** Pack de publicación sin IA: solo usa lo que se dijo en los clips y los datos reales de la marca. */
export function templatePack(plan: EditPlan, allText: string, brand: Brand, profile: EditProfile): PublishDraft {
  const n = normalize(allText);
  const devices = detectDevices(allText);
  const comps = COMPONENTS.filter(([re]) => re.test(n));
  const device = devices[0] ?? "";
  const comp = comps[0]?.[1] ?? "";
  const repair = /reparar|reparacion|arregl|cambiar|cambio|sustitu/.test(n);
  const subject = [comp && repair ? `Cambio de ${comp}` : comp ? comp[0].toUpperCase() + comp.slice(1) : repair ? "Reparación" : "", device ? (comp || repair ? `de ${device}` : device) : ""].filter(Boolean).join(" ") || "Así trabajamos";
  const titles = [
    `${subject}: mira el resultado`,
    `${subject} paso a paso`,
    plan.hook?.text && plan.hook.text !== subject ? plan.hook.text : `${subject} en ${brand.name}`,
  ].map((t) => t.slice(0, 90));
  const cta = brandCta(brand, profile.cta) || "Síguenos para ver más reparaciones";
  const descParts = [
    `${subject}${device || comp ? "" : " en el taller"}. ${plan.hook?.teaser ? "Primero el resultado y después el proceso." : "Te enseñamos el proceso."}`,
    brand.services.length ? `En ${brand.name}: ${brand.services.slice(0, 4).join(", ")}.` : "",
    brand.showLocation && brand.location ? `📍 ${brand.location}` : "",
    cta,
  ].filter(Boolean);
  const hashtags: PublishDraft["hashtags"] = [];
  const push = (tag: string, why: string) => {
    if (tag.length > 2 && !hashtags.some((h) => h.tag === tag)) hashtags.push({ tag, why });
  };
  if (brand.name) push(tagify(brand.name), "Hashtag de marca para agrupar tus vídeos");
  if (repair || comps.length) push("#reparaciondemoviles", "Describe el tema principal del vídeo");
  for (const d of devices.slice(0, 2)) push(tagify(d.split(" ")[0]), `Se menciona ${d} en el vídeo`);
  for (const c of comps.slice(0, 2)) if (c[2]) push(`#${c[2]}`, `Se habla de ${c[1]}`);
  if (repair) push("#serviciotecnico", "Público que busca un taller de reparación");
  if (brand.showLocation && brand.location) push(tagify(brand.location.split(",")[0]), "Búsquedas locales de tu zona");
  for (const h of brand.hashtags) push(h.startsWith("#") ? h : `#${h}`, "Hashtag configurado en tu marca");
  return {
    titles,
    description: descParts.join("\n\n"),
    hashtags: hashtags.slice(0, 8),
    cta,
    coverText: (plan.hook?.text || subject).slice(0, 40),
    hookSummary: plan.hook ? `Tipo «${plan.hook.type}»: ${plan.hook.candidates.find((c) => c.unitId === plan.hook!.unitId)?.why ?? ""}` : "Sin gancho: no había fragmentos aprovechables",
  };
}
