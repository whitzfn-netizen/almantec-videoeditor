import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { brandSchema, getBrand, setBrand } from "../brand.js";
import { config, paths } from "../config.js";
import { db, getSetting, newId, now, parseJson, setSetting } from "../db.js";
import { getLimits, getPrices, monthSpend, setPrices } from "../lib/costs.js";
import { ffprobe, mediaInfo, run } from "../lib/ffmpeg.js";
import { HttpError, sendFile } from "../lib/http.js";
import { BUILTIN_PROFILES, profileSchema } from "../presets.js";
import { allProviderStatus, getProviderPrefs } from "../providers/registry.js";

const dirSize = (d: string): number => {
  if (!fs.existsSync(d)) return 0;
  let s = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    s += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return s;
};

export function registerSettingsRoutes(app: FastifyInstance) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/status", async () => {
    const ff = await run("ffmpeg", ["-hide_banner", "-version"]).catch(() => null);
    return {
      ffmpeg: ff?.stdout.split("\n")[0] ?? "No encontrado",
      providers: allProviderStatus(),
      limits: getLimits(),
      spend: monthSpend(),
      storage: { projectsBytes: dirSize(paths.projects), cacheBytes: dirSize(paths.cache), libraryBytes: dirSize(paths.library) },
      retentionDays: config.retentionDays,
      maxUploadMb: config.maxUploadMb,
      authEnabled: !!config.appPassword,
    };
  });

  // ------- Perfiles -------
  app.get("/api/profiles", async () => {
    const rows = db.prepare("SELECT * FROM profiles ORDER BY builtin DESC, name").all() as Record<string, string | number>[];
    const def = getSetting<string>("defaultProfile", "almantec-viral");
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, builtin: !!r.builtin, data: profileSchema.parse(parseJson(r.data as string, {})), isDefault: r.id === def }));
  });
  const profileBody = z.object({ name: z.string().min(1).max(80), description: z.string().max(200).default(""), data: profileSchema });
  app.post("/api/profiles", async (req) => {
    const b = profileBody.parse(req.body);
    const id = newId("pf");
    db.prepare("INSERT INTO profiles (id, name, description, builtin, data, created_at) VALUES (?, ?, ?, 0, ?, ?)").run(id, b.name, b.description, JSON.stringify(b.data), now());
    return { id };
  });
  app.put("/api/profiles/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    const b = profileBody.parse(req.body);
    const row = db.prepare("SELECT builtin FROM profiles WHERE id = ?").get(id) as { builtin: number } | undefined;
    if (!row) throw new HttpError(404, "Perfil no encontrado");
    if (row.builtin) throw new HttpError(400, "Los perfiles incluidos no se modifican: guárdalo como perfil nuevo");
    db.prepare("UPDATE profiles SET name = ?, description = ?, data = ? WHERE id = ?").run(b.name, b.description, JSON.stringify(b.data), id);
    return { ok: true };
  });
  app.delete("/api/profiles/:id", async (req) => {
    const id = (req.params as { id: string }).id;
    if (BUILTIN_PROFILES.some((p) => p.id === id)) throw new HttpError(400, "Los perfiles incluidos no se pueden borrar");
    db.prepare("DELETE FROM profiles WHERE id = ? AND builtin = 0").run(id);
    if (getSetting("defaultProfile", "") === id) setSetting("defaultProfile", "almantec-viral");
    return { ok: true };
  });
  app.post("/api/profiles/:id/default", async (req) => {
    const id = (req.params as { id: string }).id;
    if (!db.prepare("SELECT 1 FROM profiles WHERE id = ?").get(id)) throw new HttpError(404, "Perfil no encontrado");
    setSetting("defaultProfile", id);
    return { ok: true };
  });

  // ------- Marca -------
  app.get("/api/settings/brand", async () => getBrand());
  app.put("/api/settings/brand", async (req) => {
    const current = getBrand();
    const b = brandSchema.parse({ ...(req.body as object), logo: current.logo });
    setBrand(b);
    return { ok: true };
  });
  app.post("/api/settings/logo", async (req) => {
    const file = await req.file();
    if (!file || !/\.png$/i.test(file.filename)) throw new HttpError(400, "El logotipo debe ser un PNG (idealmente con fondo transparente)");
    const name = `logo_${Date.now()}.png`;
    const dest = path.join(paths.brand, name);
    await pipeline(file.file, fs.createWriteStream(dest));
    try {
      const info = mediaInfo(await ffprobe(dest));
      if (!info.hasVideo || info.width < 64) throw new Error("PNG no válido o demasiado pequeño");
    } catch (e) {
      fs.rmSync(dest, { force: true });
      throw new HttpError(400, (e as Error).message);
    }
    const b = getBrand();
    if (b.logo) fs.rmSync(path.join(paths.brand, b.logo), { force: true });
    setBrand({ ...b, logo: name });
    return { ok: true };
  });
  app.get("/api/settings/logo", async (req, reply) => {
    const b = getBrand();
    return sendFile(req, reply, b.logo ? path.join(paths.brand, b.logo) : null);
  });
  app.delete("/api/settings/logo", async () => {
    const b = getBrand();
    if (b.logo) fs.rmSync(path.join(paths.brand, b.logo), { force: true });
    setBrand({ ...b, logo: undefined });
    return { ok: true };
  });

  // ------- Costes, límites y proveedores -------
  app.get("/api/settings/costs", async () => {
    const usage = db.prepare("SELECT provider, operation, units, unit_type, cost_usd, at, project_id FROM usage ORDER BY at DESC LIMIT 100").all();
    return { limits: getLimits(), prices: getPrices(), spend: monthSpend(), usage };
  });
  app.put("/api/settings/limits", async (req) => {
    const l = z.object({ perVideoUsd: z.number().min(0).max(100), monthlyUsd: z.number().min(0).max(10000), allowUnknownCost: z.boolean() }).parse(req.body);
    setSetting("limits", l);
    return { ok: true };
  });
  app.put("/api/settings/prices", async (req) => {
    const p = z.object({
      anthropic: z.record(z.string(), z.object({ input: z.number().min(0), output: z.number().min(0) })),
      elevenlabs: z.object({ perThousandChars: z.number().min(0).nullable() }),
    }).parse(req.body);
    setPrices({ ...p, updatedAt: now() });
    return { ok: true };
  });
  app.get("/api/settings/providers", async () => ({ status: allProviderStatus(), prefs: getProviderPrefs() }));
  app.put("/api/settings/providers", async (req) => {
    const p = z.object({ voice: z.enum(["auto", "piper-local", "elevenlabs"]), llmInBalanced: z.boolean(), llmModelBalanced: z.string().max(60), llmModelPremium: z.string().max(60) }).parse(req.body);
    setSetting("providerPrefs", p);
    return { ok: true };
  });

  // ------- Biblioteca de música propia -------
  app.get("/api/library/music", async () =>
    fs.readdirSync(paths.music).filter((f) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f)).map((f) => ({ name: f, size: fs.statSync(path.join(paths.music, f)).size })),
  );
  app.post("/api/library/music", async (req) => {
    const out: string[] = [];
    for await (const part of req.files()) {
      if (!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(part.filename)) {
        part.file.resume();
        continue;
      }
      const name = path.basename(part.filename).replace(/[^\p{L}\p{N}._-]+/gu, "_");
      const dest = path.join(paths.music, name);
      await pipeline(part.file, fs.createWriteStream(dest));
      try {
        if (!mediaInfo(await ffprobe(dest)).hasAudio) throw new Error();
        out.push(name);
      } catch {
        fs.rmSync(dest, { force: true });
      }
    }
    return { added: out };
  });
  app.delete("/api/library/music/:name", async (req) => {
    const name = path.basename((req.params as { name: string }).name);
    fs.rmSync(path.join(paths.music, name), { force: true });
    return { ok: true };
  });
  app.get("/api/library/music/:name", async (req, reply) => sendFile(req, reply, path.join(paths.music, path.basename((req.params as { name: string }).name))));

  app.post("/api/settings/clear-cache", async () => {
    const before = dirSize(paths.cache);
    fs.rmSync(path.join(paths.cache, "segments"), { recursive: true, force: true });
    return { freedBytes: before - dirSize(paths.cache) };
  });
}
