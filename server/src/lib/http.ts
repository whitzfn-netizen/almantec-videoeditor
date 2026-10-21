import fs from "node:fs";
import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".srt": "application/x-subrip", ".ass": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4",
};

/** Envía un archivo con soporte de rangos (necesario para el reproductor de vídeo). */
export function sendFile(req: FastifyRequest, reply: FastifyReply, file: string | null | undefined, downloadName?: string) {
  if (!file || !fs.existsSync(file)) return reply.code(404).send({ error: "Archivo no disponible" });
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  reply.header("Content-Type", type).header("Accept-Ranges", "bytes").header("Cache-Control", "private, max-age=3600");
  if (downloadName) reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
    reply.code(206).header("Content-Range", `bytes ${start}-${end}/${stat.size}`).header("Content-Length", end - start + 1);
    return reply.send(fs.createReadStream(file, { start, end }));
  }
  reply.header("Content-Length", stat.size);
  return reply.send(fs.createReadStream(file));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
