import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

const COOKIE = "avs_session";
const secret = config.sessionSecret || crypto.randomBytes(32).toString("hex");

function sign(payload: string) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function makeToken(days = 30) {
  const exp = String(Date.now() + days * 86400_000);
  return `${exp}.${sign(exp)}`;
}

export function validToken(t: string | undefined) {
  if (!t) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(exp) > Date.now();
}

export const authEnabled = () => !!config.appPassword;

function passwordOk(p: string) {
  const a = crypto.createHash("sha256").update(p).digest();
  const b = crypto.createHash("sha256").update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

export function registerAuth(app: FastifyInstance) {
  app.post("/api/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { password } = (req.body ?? {}) as { password?: string };
    if (!authEnabled()) return { ok: true };
    if (typeof password !== "string" || !passwordOk(password)) return reply.code(401).send({ error: "Contraseña incorrecta" });
    reply.setCookie(COOKIE, makeToken(), { httpOnly: true, sameSite: "strict", secure: config.production, path: "/", maxAge: 30 * 86400 });
    return { ok: true };
  });
  app.post("/api/logout", async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });
  app.get("/api/session", async (req) => ({ authenticated: !authEnabled() || validToken(req.cookies[COOKIE]), authEnabled: authEnabled() }));
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!authEnabled() || !req.url.startsWith("/api/")) return;
    if (["/api/login", "/api/session", "/api/health"].some((p) => req.url.startsWith(p))) return;
    if (!validToken(req.cookies[COOKIE])) return reply.code(401).send({ error: "Inicia sesión para continuar" });
  });
}
