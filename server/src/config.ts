import path from "node:path";
import fs from "node:fs";

/** Lee .env (si existe) sin dependencias externas. Las variables ya definidas tienen prioridad. */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const root = path.resolve(process.env.APP_ROOT ?? path.join(import.meta.dirname, "..", ".."));
loadDotEnv(path.join(root, ".env"));

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  root,
  port: num(process.env.PORT, 8080),
  host: process.env.HOST ?? "0.0.0.0",
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, "data")),
  modelsDir: path.resolve(process.env.MODELS_DIR ?? path.join(root, "models")),
  webDist: path.join(root, "web", "dist"),
  /** Contraseña de acceso a la aplicación privada. Si falta, el servidor se niega a arrancar en producción. */
  appPassword: process.env.APP_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",
  production: process.env.NODE_ENV === "production",
  maxUploadMb: num(process.env.MAX_UPLOAD_MB, 2048),
  maxFilesPerUpload: num(process.env.MAX_FILES_PER_UPLOAD, 20),
  /** Días que se conservan originales y renders. 0 = sin borrado automático. */
  retentionDays: num(process.env.RETENTION_DAYS, 0),
  /** Ejecutar el procesador de trabajos dentro del servidor web (cómodo en local). */
  inlineWorker: process.env.INLINE_WORKER !== "0",
  threads: num(process.env.FFMPEG_THREADS, 0),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
};

export const paths = {
  db: path.join(config.dataDir, "studio.db"),
  projects: path.join(config.dataDir, "projects"),
  cache: path.join(config.dataDir, "cache"),
  library: path.join(config.dataDir, "library"),
  music: path.join(config.dataDir, "library", "music"),
  brand: path.join(config.dataDir, "library", "brand"),
  references: path.join(config.dataDir, "references"),
  project: (id: string) => path.join(config.dataDir, "projects", id),
};

export function ensureDirs() {
  for (const p of [config.dataDir, paths.projects, paths.cache, paths.library, paths.music, paths.brand, paths.references]) {
    fs.mkdirSync(p, { recursive: true });
  }
}
