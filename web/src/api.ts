export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: string[]) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(url, init);
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (res.status === 401 && !url.endsWith("/login")) window.dispatchEvent(new Event("avs:logout"));
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Error ${res.status}`, data?.details);
  return data as T;
}

export const api = {
  get: <T>(u: string) => req<T>("GET", u),
  post: <T>(u: string, b?: unknown) => req<T>("POST", u, b ?? {}),
  put: <T>(u: string, b: unknown) => req<T>("PUT", u, b),
  patch: <T>(u: string, b: unknown) => req<T>("PATCH", u, b),
  del: <T>(u: string) => req<T>("DELETE", u),
  upload: <T>(u: string, files: File[], onProgress?: (f: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const fd = new FormData();
      for (const f of files) fd.append("files", f, f.name);
      const x = new XMLHttpRequest();
      x.open("POST", u);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => {
        let data: { error?: string } | null = null;
        try {
          data = JSON.parse(x.responseText);
        } catch {
          /* respuesta no JSON */
        }
        if (x.status >= 200 && x.status < 300) resolve(data as T);
        else reject(new ApiError(x.status, data?.error ?? `Error ${x.status}`));
      };
      x.onerror = () => reject(new ApiError(0, "Se perdió la conexión durante la subida"));
      x.send(fd);
    }),
};

export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
export const fmtDur = (s: number | null | undefined) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtUsd = (x: number | null | undefined) => (x == null ? "desconocido" : x < 0.01 && x > 0 ? `${x.toFixed(4)} USD` : `${x.toFixed(2)} USD`);
