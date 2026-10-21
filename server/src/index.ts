import path from "node:path";
import { pathToFileURL } from "node:url";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import fs from "node:fs";
import { ZodError } from "zod";
import { registerAuth } from "./auth.js";
import { config } from "./config.js";
import { HttpError } from "./lib/http.js";
import { seedProfiles } from "./presets.js";
import { startWorker } from "./queue.js";
import { startRetention } from "./retention.js";
import { registerIntelRoutes } from "./routes/intel.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerSettingsRoutes } from "./routes/settings.js";

if (config.production && (!config.appPassword || config.appPassword.length < 10 || !config.sessionSecret)) {
  console.error("En producción es obligatorio definir APP_PASSWORD (mín. 10 caracteres) y SESSION_SECRET en el .env");
  process.exit(1);
}

export async function buildApp() {
  seedProfiles();
  const app = Fastify({ logger: { level: config.production ? "info" : "warn" }, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: config.maxFilesPerUpload, fields: 20 } });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "same-origin").header("X-Frame-Options", "DENY");
  });
  registerAuth(app);
  registerSettingsRoutes(app);
  registerProjectRoutes(app);
  registerIntelRoutes(app);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Datos no válidos", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: `El archivo supera ${config.maxUploadMb} MB` });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    app.log.error(err);
    // Nunca se envían trazas ni secretos al navegador.
    return reply.code(500).send({ error: "Error interno del servidor. Revisa el registro del servidor para más detalles." });
  });
  if (fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") || req.url.startsWith("/assets/") ? reply.code(404).send({ error: "No encontrado" }) : reply.sendFile("index.html")));
  }
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  console.log(`AlmanTec Viral Studio en http://localhost:${config.port}${config.appPassword ? "" : "  (⚠ sin contraseña: define APP_PASSWORD)"}`);
  if (config.inlineWorker) {
    startWorker();
    startRetention();
  }
}
