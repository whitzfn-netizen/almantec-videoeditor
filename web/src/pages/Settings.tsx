import { useCallback, useEffect, useState } from "react";
import { api, ApiError, fmtBytes, fmtDate, fmtUsd } from "../api";
import { ProfileOptions } from "../components/ProfileOptions";
import { Icon, useToast } from "../components/ui";
import type { Profile, ProfileRow, ProviderStatus } from "../types";

type Tab = "proveedores" | "marca" | "perfiles" | "costes" | "musica" | "almacenamiento";

export default function Settings() {
  const [tab, setTab] = useState<Tab>("proveedores");
  return (
    <div className="fade">
      <div className="page-head"><div><h1>Configuración</h1><p className="muted">Proveedores, marca, perfiles, costes y archivos.</p></div></div>
      <div className="tabs">
        {([["proveedores", "Proveedores de IA y voz"], ["marca", "Marca AlmanTec"], ["perfiles", "Perfiles y subtítulos"], ["costes", "Costes y límites"], ["musica", "Música"], ["almacenamiento", "Almacenamiento"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "proveedores" && <Providers />}
      {tab === "marca" && <Brand />}
      {tab === "perfiles" && <Profiles />}
      {tab === "costes" && <Costs />}
      {tab === "musica" && <Music />}
      {tab === "almacenamiento" && <Storage />}
    </div>
  );
}

function useErr() {
  const toast = useToast();
  return (e: unknown) => toast(e instanceof ApiError ? `${e.message}${e.details ? ": " + e.details.join("; ") : ""}` : "Error");
}

function Providers() {
  const toast = useToast();
  const onErr = useErr();
  const [d, setD] = useState<{ status: ProviderStatus[]; prefs: { voice: string; llmInBalanced: boolean; llmModelBalanced: string; llmModelPremium: string } } | null>(null);
  useEffect(() => void api.get<typeof d>("/api/settings/providers").then(setD), []);
  if (!d) return null;
  const save = (prefs: typeof d.prefs) => api.put("/api/settings/providers", prefs).then(() => { setD({ ...d, prefs }); toast("Guardado"); }, onErr);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="notice small">
        Las claves de API <b>nunca</b> se escriben en esta web: se guardan solo en el archivo <code>.env</code> del servidor (ver README). Aquí se muestra qué está listo y qué falta. Los proveedores marcados como «externo» reciben datos: se indica exactamente cuáles.
      </div>
      <div className="grid grid-2">
        {d.status.map((p) => (
          <div className="card" key={p.id}>
            <div className="card-head">
              <h3>{p.label}</h3>
              <div className="row">
                {p.external ? <span className="badge warn">externo</span> : <span className="badge">local</span>}
                <span className={`badge ${p.ready ? "ok" : "err"}`}>{p.ready ? "Listo" : "No configurado"}</span>
              </div>
            </div>
            <p className="small muted">{p.costNote}</p>
            {p.missing && <p className="small" style={{ color: "var(--warn)", marginTop: 6 }}>Falta: {p.missing}</p>}
            {!p.verified && <p className="small faint" style={{ marginTop: 6 }}>Adaptador implementado; pendiente de verificar con una clave real.</p>}
          </div>
        ))}
      </div>
      <div className="card stack">
        <h2>Preferencias</h2>
        <div className="grid grid-2">
          <label className="field">Motor de voz en off
            <select value={d.prefs.voice} onChange={(e) => void save({ ...d.prefs, voice: e.target.value })}>
              <option value="auto">Automático (ElevenLabs si está configurado; si no, voz local)</option>
              <option value="piper-local">Siempre voz local (gratis)</option>
              <option value="elevenlabs">Siempre ElevenLabs</option>
            </select>
          </label>
          <label className="field">Modelo de Claude en modo equilibrado
            <select value={d.prefs.llmModelBalanced} onChange={(e) => void save({ ...d.prefs, llmModelBalanced: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (mejor criterio)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (más barato)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (el más barato)</option>
            </select>
          </label>
          <label className="field">Modelo de Claude en modo premium
            <select value={d.prefs.llmModelPremium} onChange={(e) => void save({ ...d.prefs, llmModelPremium: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
            </select>
          </label>
          <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={d.prefs.llmInBalanced} onChange={(e) => void save({ ...d.prefs, llmInBalanced: e.target.checked })} />Usar Claude en el modo equilibrado</label>
        </div>
      </div>
    </div>
  );
}

interface BrandT { name: string; services: string[]; location: string; showLocation: boolean; web: string; instagram: string; tiktok: string; youtube: string; contact: string; ctas: string[]; accent: string; logo?: string; showLogo: boolean; keywords: string[]; corrections: Record<string, string>; hashtags: string[] }

function Brand() {
  const toast = useToast();
  const onErr = useErr();
  const [b, setB] = useState<BrandT | null>(null);
  const [logoV, setLogoV] = useState(0);
  const load = useCallback(() => void api.get<BrandT>("/api/settings/brand").then(setB), []);
  useEffect(load, [load]);
  if (!b) return null;
  const list = (v: string[]) => v.join("\n");
  const parse = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const corr = Object.entries(b.corrections).map(([k, v]) => `${k} = ${v}`).join("\n");
  return (
    <form className="stack" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); void api.put("/api/settings/brand", b).then(() => toast("Marca guardada"), onErr); }}>
      <div className="notice small">Estos datos se usan para las llamadas a la acción, descripciones y hashtags. La aplicación nunca inventa datos comerciales: si un campo está vacío, no se menciona.</div>
      <div className="card stack">
        <div className="grid grid-3">
          <label className="field">Nombre comercial<input type="text" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></label>
          <label className="field">Web<input type="text" value={b.web} onChange={(e) => setB({ ...b, web: e.target.value })} placeholder="almantec.es" /></label>
          <label className="field">Contacto (teléfono, WhatsApp…)<input type="text" value={b.contact} onChange={(e) => setB({ ...b, contact: e.target.value })} /></label>
          <label className="field">Instagram<input type="text" value={b.instagram} onChange={(e) => setB({ ...b, instagram: e.target.value })} placeholder="@almantec" /></label>
          <label className="field">TikTok<input type="text" value={b.tiktok} onChange={(e) => setB({ ...b, tiktok: e.target.value })} /></label>
          <label className="field">YouTube<input type="text" value={b.youtube} onChange={(e) => setB({ ...b, youtube: e.target.value })} /></label>
          <label className="field">Ubicación<input type="text" value={b.location} onChange={(e) => setB({ ...b, location: e.target.value })} /></label>
          <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={b.showLocation} onChange={(e) => setB({ ...b, showLocation: e.target.checked })} />Mostrar la ubicación en las publicaciones</label>
          <label className="field">Color de acento<input type="color" value={b.accent} onChange={(e) => setB({ ...b, accent: e.target.value })} style={{ height: 40, padding: 4 }} /></label>
        </div>
      </div>
      <div className="grid grid-2">
        <label className="field card">Servicios reales (uno por línea)<textarea value={list(b.services)} onChange={(e) => setB({ ...b, services: parse(e.target.value) })} placeholder={"Cambio de pantalla\nCambio de batería\nMicrosoldadura"} /></label>
        <label className="field card">Llamadas a la acción preferidas (una por línea)<textarea value={list(b.ctas)} onChange={(e) => setB({ ...b, ctas: parse(e.target.value) })} placeholder="Pide presupuesto por WhatsApp" /></label>
        <label className="field card">Productos y términos que deben escribirse bien (se resaltan)<textarea value={list(b.keywords)} onChange={(e) => setB({ ...b, keywords: parse(e.target.value) })} placeholder={"iPhone\nGalaxy S24\nFace ID"} /></label>
        <label className="field card">Correcciones de transcripción («como se oye = como se escribe»)<textarea defaultValue={corr} onBlur={(e) => setB({ ...b, corrections: Object.fromEntries(parse(e.target.value).map((l) => l.split("=").map((x) => x.trim())).filter((x) => x.length === 2 && x[0])) })} placeholder={"ifon = iPhone\nalmantek = AlmanTec"} /></label>
        <label className="field card">Hashtags propios (uno por línea)<textarea value={list(b.hashtags)} onChange={(e) => setB({ ...b, hashtags: parse(e.target.value) })} placeholder="#almantec" /></label>
        <div className="card stack">
          <div className="small muted">Logotipo (PNG con transparencia)</div>
          {b.logo && <img src={`/api/settings/logo?v=${logoV}`} alt="Logotipo" style={{ maxHeight: 80, maxWidth: 200, background: "#333", borderRadius: 8, padding: 6 }} />}
          <div className="row">
            <label className="btn btn-sm"><Icon name="upload" />Subir PNG<input type="file" accept="image/png" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append("file", f);
              const r = await fetch("/api/settings/logo", { method: "POST", body: fd });
              if (!r.ok) toast((await r.json()).error);
              else { setLogoV(Date.now()); load(); }
            }} /></label>
            {b.logo && <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del("/api/settings/logo").then(load)}>Quitar</button>}
          </div>
          <label className="check"><input type="checkbox" checked={b.showLogo} onChange={(e) => setB({ ...b, showLogo: e.target.checked })} />Mostrar el logotipo en los vídeos (esquina superior)</label>
        </div>
      </div>
      <div><button className="btn btn-primary">Guardar marca</button></div>
    </form>
  );
}

function Profiles() {
  const toast = useToast();
  const onErr = useErr();
  const [rows, setRows] = useState<ProfileRow[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; data: Profile } | null>(null);
  const [music, setMusic] = useState<string[]>([]);
  const load = useCallback(() => void api.get<ProfileRow[]>("/api/profiles").then(setRows), []);
  useEffect(() => {
    load();
    void api.get<{ name: string }[]>("/api/library/music").then((m) => setMusic(m.map((x) => x.name)));
  }, [load]);
  if (edit)
    return (
      <div className="card stack" style={{ gap: 16 }}>
        <h2>{edit.id ? "Editar perfil" : "Nuevo perfil"}</h2>
        <div className="grid grid-2">
          <label className="field">Nombre<input type="text" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field">Descripción<input type="text" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
        </div>
        <ProfileOptions value={edit.data} onChange={(data) => setEdit({ ...edit, data })} musicTracks={music} />
        <div className="row">
          <button className="btn btn-primary" disabled={!edit.name.trim()} onClick={() => {
            const body = { name: edit.name, description: edit.description, data: edit.data };
            void (edit.id ? api.put(`/api/profiles/${edit.id}`, body) : api.post("/api/profiles", body)).then(() => { toast("Perfil guardado"); setEdit(null); load(); }, onErr);
          }}>Guardar perfil</button>
          <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
        </div>
      </div>
    );
  return (
    <div className="stack" style={{ gap: 14 }}>
      <p className="muted small">El perfil predeterminado se aplica al subir clips y pulsar «Generar vídeo viral» directamente. Para cambiar el estilo de subtítulos por defecto, crea un perfil con ese estilo y márcalo como predeterminado.</p>
      <div className="grid grid-auto">
        {rows.map((r) => (
          <div className="card stack" key={r.id}>
            <div className="row" style={{ justifyContent: "space-between" }}><h3>{r.name}</h3>{r.isDefault && <span className="badge accent">Predeterminado</span>}</div>
            <p className="small muted">{r.description}</p>
            <p className="small faint">Cortes {r.data.cutIntensity} · subtítulos {r.data.subtitleStyle} · {r.data.targetDuration || "auto"} s · voz {r.data.voiceover.mode} · {r.data.music.enabled ? "con música" : "sin música"}</p>
            <div className="row" style={{ marginTop: "auto" }}>
              {!r.isDefault && <button className="btn btn-sm" onClick={() => api.post(`/api/profiles/${r.id}/default`).then(load)}>Usar por defecto</button>}
              <button className="btn btn-sm" onClick={() => setEdit({ id: r.builtin ? undefined : r.id, name: r.builtin ? `${r.name} (mío)` : r.name, description: r.description, data: r.data })}>{r.builtin ? "Copiar y editar" : "Editar"}</button>
              {!r.builtin && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/profiles/${r.id}`).then(load)}><Icon name="trash" /></button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Costs() {
  const toast = useToast();
  const onErr = useErr();
  const [d, setD] = useState<{ limits: { perVideoUsd: number; monthlyUsd: number; allowUnknownCost: boolean }; prices: { anthropic: Record<string, { input: number; output: number }>; elevenlabs: { perThousandChars: number | null }; updatedAt: string }; spend: { known: number; unknownCalls: number }; usage: { provider: string; operation: string; units: number; unit_type: string; cost_usd: number | null; at: string }[] } | null>(null);
  const load = useCallback(() => void api.get<typeof d>("/api/settings/costs").then(setD), []);
  useEffect(load, [load]);
  if (!d) return null;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid grid-3">
        <div className="card"><div className="small muted">Gasto conocido este mes</div><h1 className="mono">{fmtUsd(d.spend.known)}</h1>{d.spend.unknownCalls > 0 && <div className="small" style={{ color: "var(--warn)" }}>+ {d.spend.unknownCalls} operación(es) con coste desconocido</div>}</div>
        <div className="card"><div className="small muted">Límite por vídeo</div><h1 className="mono">{fmtUsd(d.limits.perVideoUsd)}</h1></div>
        <div className="card"><div className="small muted">Límite mensual</div><h1 className="mono">{fmtUsd(d.limits.monthlyUsd)}</h1></div>
      </div>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void api.put("/api/settings/limits", d.limits).then(() => toast("Límites guardados"), onErr); }}>
        <h2>Límites de gasto</h2>
        <p className="small muted">Antes de cada operación de pago se estima su coste; si superaría un límite, no se hace y se usa la alternativa local.</p>
        <div className="grid grid-3">
          <label className="field">Máximo por vídeo (USD)<input type="number" step="0.01" min={0} value={d.limits.perVideoUsd} onChange={(e) => setD({ ...d, limits: { ...d.limits, perVideoUsd: Number(e.target.value) } })} /></label>
          <label className="field">Máximo mensual (USD)<input type="number" step="0.5" min={0} value={d.limits.monthlyUsd} onChange={(e) => setD({ ...d, limits: { ...d.limits, monthlyUsd: Number(e.target.value) } })} /></label>
          <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={d.limits.allowUnknownCost} onChange={(e) => setD({ ...d, limits: { ...d.limits, allowUnknownCost: e.target.checked } })} />Permitir operaciones de coste desconocido</label>
        </div>
        <div><button className="btn btn-primary">Guardar límites</button></div>
      </form>
      <form className="card stack" onSubmit={(e) => { e.preventDefault(); void api.put("/api/settings/prices", { anthropic: d.prices.anthropic, elevenlabs: d.prices.elevenlabs }).then(() => toast("Tarifas guardadas"), onErr); }}>
        <h2>Tarifas</h2>
        <p className="small muted">Actualizadas el {d.prices.updatedAt}. Revisa las tarifas vigentes de cada proveedor y corrígelas aquí; si un precio está vacío, el coste se muestra como desconocido.</p>
        <table className="t">
          <thead><tr><th>Modelo de Claude</th><th>Entrada (USD / millón de tokens)</th><th>Salida (USD / millón de tokens)</th></tr></thead>
          <tbody>
            {Object.entries(d.prices.anthropic).map(([m, p]) => (
              <tr key={m}><td className="mono small">{m}</td>
                <td><input type="number" step="0.01" min={0} value={p.input} onChange={(e) => setD({ ...d, prices: { ...d.prices, anthropic: { ...d.prices.anthropic, [m]: { ...p, input: Number(e.target.value) } } } })} /></td>
                <td><input type="number" step="0.01" min={0} value={p.output} onChange={(e) => setD({ ...d, prices: { ...d.prices, anthropic: { ...d.prices.anthropic, [m]: { ...p, output: Number(e.target.value) } } } })} /></td></tr>
            ))}
          </tbody>
        </table>
        <label className="field" style={{ maxWidth: 320 }}>ElevenLabs: USD por 1.000 caracteres (vacío = desconocido)
          <input type="number" step="0.001" min={0} value={d.prices.elevenlabs.perThousandChars ?? ""} onChange={(e) => setD({ ...d, prices: { ...d.prices, elevenlabs: { perThousandChars: e.target.value === "" ? null : Number(e.target.value) } } })} />
        </label>
        <div><button className="btn btn-primary">Guardar tarifas</button></div>
      </form>
      <div className="card">
        <h2 style={{ marginBottom: 10 }}>Registro de consumo</h2>
        {!d.usage.length ? <p className="muted">Todavía no se ha usado ningún proveedor de pago.</p> : (
          <table className="t"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Operación</th><th>Unidades</th><th>Coste</th></tr></thead>
            <tbody>{d.usage.map((u, i) => <tr key={i}><td className="small">{fmtDate(u.at)}</td><td>{u.provider}</td><td>{u.operation}</td><td className="mono small">{Math.round(u.units)} {u.unit_type}</td><td className="mono">{fmtUsd(u.cost_usd)}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
  );
}

function Music() {
  const toast = useToast();
  const [rows, setRows] = useState<{ name: string; size: number }[]>([]);
  const load = useCallback(() => void api.get<typeof rows>("/api/library/music").then(setRows), []);
  useEffect(load, [load]);
  return (
    <div className="card stack">
      <div className="notice small">Sube solo música propia o con licencia que permita uso comercial en redes (por ejemplo, la biblioteca de audio libre de tu plataforma o una licencia comprada). La aplicación no descarga música de terceros. La música siempre suena por debajo de la voz y baja automáticamente cuando alguien habla.</div>
      <div className="row">
        <label className="btn btn-primary"><Icon name="upload" />Subir pistas<input type="file" accept="audio/*" multiple hidden onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          if (!files.length) return;
          const r = await api.upload<{ added: string[] }>("/api/library/music", files);
          toast(`${r.added.length} pista(s) añadidas`);
          load();
        }} /></label>
      </div>
      {!rows.length && <p className="muted">No hay música. Los vídeos se generarán sin música de fondo.</p>}
      {rows.map((r) => (
        <div className="unit" key={r.name}>
          <div><div>{r.name}</div><div className="small faint">{fmtBytes(r.size)}</div></div>
          <div className="row">
            <audio src={`/api/library/music/${encodeURIComponent(r.name)}`} controls preload="none" style={{ height: 32 }} />
            <button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/library/music/${encodeURIComponent(r.name)}`).then(load)}><Icon name="trash" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Storage() {
  const toast = useToast();
  const [s, setS] = useState<{ ffmpeg: string; storage: { projectsBytes: number; cacheBytes: number; libraryBytes: number }; retentionDays: number; maxUploadMb: number; authEnabled: boolean } | null>(null);
  const load = useCallback(() => void api.get<typeof s>("/api/status").then(setS), []);
  useEffect(load, [load]);
  if (!s) return null;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="grid grid-3">
        <div className="card"><div className="small muted">Proyectos (originales y vídeos)</div><h2 className="mono">{fmtBytes(s.storage.projectsBytes)}</h2></div>
        <div className="card"><div className="small muted">Caché de análisis y fragmentos</div><h2 className="mono">{fmtBytes(s.storage.cacheBytes)}</h2></div>
        <div className="card"><div className="small muted">Biblioteca (música y marca)</div><h2 className="mono">{fmtBytes(s.storage.libraryBytes)}</h2></div>
      </div>
      <div className="card stack">
        <h2>Política de retención</h2>
        <p className="small">{s.retentionDays ? `Los originales y vídeos de proyectos sin actividad durante ${s.retentionDays} días se borran automáticamente (se conservan los planes y textos).` : "Sin borrado automático: los archivos se conservan hasta que borres el proyecto. Puedes activarlo con RETENTION_DAYS en el .env."}</p>
        <p className="small muted">Al borrar un proyecto se eliminan sus originales, versiones y archivos de trabajo. Tamaño máximo por archivo: {s.maxUploadMb} MB.</p>
        <div><button className="btn" onClick={() => api.post<{ freedBytes: number }>("/api/settings/clear-cache").then((r) => { toast(`Liberados ${fmtBytes(r.freedBytes)}`); load(); })}>Vaciar caché de fragmentos renderizados</button></div>
        <p className="small faint">La caché acelera las revisiones y variaciones. Las transcripciones y análisis se conservan para no repetirlos.</p>
      </div>
      <div className="card small">
        <dl className="kv"><dt>Motor de vídeo</dt><dd className="mono">{s.ffmpeg}</dd><dt>Acceso</dt><dd>{s.authEnabled ? "Protegido con contraseña" : "⚠ Sin contraseña (define APP_PASSWORD)"}</dd></dl>
      </div>
    </div>
  );
}
