/** Vocabulario del sector (reparación de móviles y electrónica) para relevancia y resaltado. */
export const TECH_TERMS = [
  "pantalla", "batería", "bateria", "cámara", "camara", "conector", "carga", "placa", "chip", "tornillo", "tornillos",
  "cristal", "táctil", "tactil", "display", "lcd", "oled", "flex", "altavoz", "micrófono", "microfono", "botón", "boton",
  "carcasa", "tapa", "reparación", "reparacion", "reparar", "cambiar", "cambio", "sustituir", "soldar", "soldadura",
  "estaño", "microsoldadura", "diagnóstico", "diagnostico", "avería", "averia", "roto", "rota", "agua", "humedad",
  "enciende", "funciona", "iphone", "samsung", "xiaomi", "huawei", "oppo", "pixel", "ipad", "android", "móvil", "movil",
  "tablet", "portátil", "portatil", "consola", "ps5", "switch", "usb", "lightning", "face id", "touch id", "placa base",
  "resultado", "antes", "después", "despues", "nuevo", "nueva", "garantía", "garantia", "presupuesto",
];

export const FILLERS = ["eh", "ehh", "em", "emm", "mmm", "mm", "este", "bueno", "vale", "pues", "o sea", "a ver", "ah", "uh", "um"];

const CURIOSITY = ["mira", "fíjate", "fijate", "atento", "increíble", "increible", "sorpresa", "nadie", "secreto", "por qué", "porque", "cómo", "como", "qué", "imposible", "truco", "error", "nunca", "siempre"];
const RESULT = ["listo", "queda", "quedado", "funciona", "perfecto", "como nuevo", "terminado", "resultado", "después", "despues", "arreglado", "enciende", "solucionado"];
const PROBLEM = ["problema", "roto", "rota", "no enciende", "no carga", "avería", "averia", "falla", "fallo", "mojado", "agua", "golpe", "estropeado"];

export function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function tokens(s: string) {
  return normalize(s).split(" ").filter((w) => w.length > 2);
}

const hits = (text: string, list: string[]) => {
  const n = ` ${normalize(text)} `;
  return list.filter((w) => n.includes(` ${normalize(w)} `)).length;
};

export const techHits = (t: string) => hits(t, TECH_TERMS);
export const curiosityHits = (t: string) => hits(t, CURIOSITY) + (t.includes("?") ? 2 : 0) + (/\d/.test(t) ? 1 : 0);
export const resultHits = (t: string) => hits(t, RESULT);
export const problemHits = (t: string) => hits(t, PROBLEM);

export function isFillerOnly(text: string) {
  const n = normalize(text);
  if (!n) return true;
  let rest = ` ${n} `;
  for (const f of FILLERS.sort((a, b) => b.length - a.length)) rest = rest.replaceAll(` ${f} `, " ");
  return rest.trim().length === 0;
}

/** Similitud entre dos frases (solapamiento de palabras sobre la más corta). */
const NUMBER_WORDS = new Set(["uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "primero", "primer", "primera", "segundo", "segunda", "tercero", "tercer", "tercera", "cuarto", "cuarta", "quinto", "quinta", "ultimo", "ultima"]);

export function similarity(a: string, b: string) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size < 4 || B.size < 4) return 0;
  // «Paso 1…» y «Paso 2…» son pasos distintos, no tomas repetidas.
  const nums = (t: string) => [...new Set(normalize(t).split(" ").filter((w) => /^\d+$/.test(w) || NUMBER_WORDS.has(w)))].sort().join(",");
  const na = nums(a), nb = nums(b);
  if (na && nb && na !== nb) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Detecta dispositivos o marcas mencionados (solo lo que aparece literalmente en el audio). */
export function detectDevices(text: string): string[] {
  const n = normalize(text);
  const found = new Set<string>();
  const re = /\b(iphone|samsung|galaxy|xiaomi|redmi|huawei|oppo|pixel|ipad|macbook|motorola|realme|oneplus|honor|vivo|ps5|ps4|switch|xbox)\b(\s+(pro|max|plus|ultra|mini|\d{1,2}[a-z]?))*/g;
  for (const m of n.matchAll(re)) found.add(m[0].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Iphone/, "iPhone").replace(/^Ipad/, "iPad").replace(/^Macbook/, "MacBook").replace(/^Ps(\d)/, "PS$1"));
  return [...found];
}

/** Aplica el diccionario de correcciones de la marca (p. ej. «ifon» → «iPhone»). */
export function applyCorrections(text: string, dict: Record<string, string>) {
  let out = text;
  for (const [from, to] of Object.entries(dict)) {
    if (!from.trim()) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), to);
  }
  return out;
}
