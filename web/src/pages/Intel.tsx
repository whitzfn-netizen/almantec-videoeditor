import { Fragment, useCallback, useEffect, useState } from "react";
import { api, ApiError, fmtDate, fmtUsd } from "../api";
import { Icon, useToast } from "../components/ui";
import type { ProjectRow } from "../types";

type Tab = "refs" | "hooks" | "ideas" | "metrics";

export default function Intel() {
  const [tab, setTab] = useState<Tab>("refs");
  return (
    <div className="fade">
      <div className="page-head">
        <div>
          <h1>Inteligencia de contenido</h1>
          <p className="muted">Referencias, ganchos, ideas y el rendimiento real de tus publicaciones.</p>
        </div>
      </div>
      <div className="tabs">
        {([["refs", "Referencias y competencia"], ["hooks", "Biblioteca de ganchos"], ["ideas", "Ideas"], ["metrics", "Rendimiento"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "refs" && <Refs />}
      {tab === "hooks" && <Hooks />}
      {tab === "ideas" && <Ideas />}
      {tab === "metrics" && <Metrics />}
    </div>
  );
}

interface Ref { id: string; title: string; url: string | null; platform: string; notes: string; manual: Record<string, unknown>; analysis: { local?: Record<string, unknown>; ai?: Record<string, unknown>; aiCostUsd?: number } | null; hasFile: boolean; createdAt: string }

function Refs() {
  const toast = useToast();
  const [rows, setRows] = useState<Ref[]>([]);
  const [form, setForm] = useState({ title: "", url: "", platform: "instagram", notes: "", views: "", hookType: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => void api.get<Ref[]>("/api/refs").then(setRows), []);
  useEffect(load, [load]);
  const err = (e: unknown) => toast(e instanceof ApiError ? e.message : "Error");
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="notice small">
        Solo se usan fuentes autorizadas: no se hace scraping ni se accede a cuentas ajenas. Si un enlace no se puede procesar, sube el vídeo (si tienes permiso para analizarlo), añade capturas o escribe los datos a mano. Las referencias sirven para extraer técnicas generales, nunca para copiar contenido.
      </div>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post("/api/refs", { title: form.title, url: form.url, platform: form.platform, notes: form.notes, manual: { views: form.views ? Number(form.views) : null, hookType: form.hookType || undefined } });
            setForm({ title: "", url: "", platform: "instagram", notes: "", views: "", hookType: "" });
            load();
          } catch (e2) {
            err(e2);
          }
        }}
      >
        <h2>Añadir referencia</h2>
        <div className="grid grid-3">
          <label className="field">Título o perfil<input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej.: @taller_x – cambio de batería" /></label>
          <label className="field">Enlace (opcional)<input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></label>
          <label className="field">Plataforma
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              <option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="otra">Otra</option>
            </select>
          </label>
        </div>
        <div className="grid grid-3">
          <label className="field">Visualizaciones públicas (si se ven)<input type="number" min={0} value={form.views} onChange={(e) => setForm({ ...form, views: e.target.value })} /></label>
          <label className="field">Tipo de gancho observado<input type="text" value={form.hookType} onChange={(e) => setForm({ ...form, hookType: e.target.value })} placeholder="Ej.: resultado primero" /></label>
          <label className="field">Notas<input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Qué te llama la atención" /></label>
        </div>
        <div><button className="btn btn-primary">Guardar referencia</button></div>
      </form>
      {rows.map((r) => {
        const L = r.analysis?.local as Record<string, number | string | null> | undefined;
        const A = r.analysis?.ai as Record<string, string | string[]> | undefined;
        return (
          <div className="card" key={r.id}>
            <div className="card-head">
              <div>
                <h3>{r.title}</h3>
                <div className="small muted">{r.platform} · {fmtDate(r.createdAt)}{r.url ? <> · <a href={r.url} target="_blank" rel="noreferrer noopener" style={{ color: "var(--accent)" }}>abrir enlace</a></> : null}</div>
              </div>
              <div className="row">
                <label className="btn btn-sm">
                  <Icon name="upload" />{busy === r.id ? "Analizando…" : "Subir vídeo"}
                  <input type="file" accept="video/*" hidden onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setBusy(r.id);
                    const fd = new FormData();
                    fd.append("file", f);
                    try {
                      const res = await fetch(`/api/refs/${r.id}/video`, { method: "POST", body: fd });
                      if (!res.ok) throw new ApiError(res.status, (await res.json()).error);
                      load();
                    } catch (e2) {
                      err(e2);
                    } finally {
                      setBusy(null);
                    }
                  }} />
                </label>
                {r.hasFile && <button className="btn btn-sm" onClick={() => api.post<{ costUsd: number | null }>(`/api/refs/${r.id}/ai`).then((x) => { toast(`Análisis con IA hecho (${fmtUsd(x.costUsd)})`); load(); }, err)}><Icon name="spark" />Analizar con IA</button>}
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/refs/${r.id}`).then(load)}><Icon name="trash" /></button>
              </div>
            </div>
            {r.notes && <p className="small">{r.notes}</p>}
            {(r.manual.views != null || !!r.manual.hookType) && <p className="small muted">Datos manuales: {r.manual.views != null ? `${r.manual.views} visualizaciones` : ""} {r.manual.hookType ? `· gancho «${String(r.manual.hookType)}»` : ""}</p>}
            {L && (
              <dl className="kv small" style={{ marginTop: 10 }}>
                <dt>Duración</dt><dd>{L.duration} s · {L.aspect} ({L.resolution})</dd>
                <dt>Velocidad de edición</dt><dd>{L.cutsPerMinute} cortes/min · plano medio de {L.avgShotSeconds} s</dd>
                <dt>Voz</dt><dd>{Math.round(Number(L.speechRatio) * 100)} % del vídeo{L.firstSpeechAt != null ? ` · empieza a hablar en ${L.firstSpeechAt} s` : " · sin voz"}</dd>
                {L.openingText ? <><dt>Primeras palabras</dt><dd>«{L.openingText}»</dd></> : null}
              </dl>
            )}
            {A && (
              <div className="stack small" style={{ marginTop: 10 }}>
                <b>Análisis con IA</b>
                <dl className="kv">
                  {(["hookType", "structure", "editingPace", "subtitleStyle", "voiceover", "shotTypes", "soundAndMusic", "cta"] as const).map((k) => <Fragment key={k}><dt>{({ hookType: "Gancho", structure: "Estructura", editingPace: "Ritmo", subtitleStyle: "Subtítulos", voiceover: "Voz en off", shotTypes: "Planos", soundAndMusic: "Sonido", cta: "CTA" })[k]}</dt><dd>{String(A[k])}</dd></Fragment>)}
                </dl>
                <div><b>Por qué puede funcionar:</b><ul className="clean">{(A.whyItWorks as string[]).map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><b>Ideas para AlmanTec:</b><ul className="clean">{(A.ideasForAlmanTec as string[]).map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Hooks() {
  const [data, setData] = useState<{ hooks: { id: string; text: string; type: string; source: string; notes: string }[]; used: { versionId: string; project: string; type: string; text: string }[] } | null>(null);
  const [f, setF] = useState({ text: "", type: "resultado" });
  const load = useCallback(() => void api.get<typeof data>("/api/hooks").then(setData), []);
  useEffect(load, [load]);
  if (!data) return null;
  return (
    <div className="grid grid-2">
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Tus ganchos guardados</h2>
        <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); void api.post("/api/hooks", f).then(() => { setF({ ...f, text: "" }); load(); }); }}>
          <input type="text" required placeholder="Nuevo gancho" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} style={{ flex: 2 }} />
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} style={{ flex: 1 }}>
            {["resultado", "antes_despues", "problema_solucion", "pregunta", "error_habitual", "dato", "reparacion_complicada", "comparacion", "demostracion", "transformacion"].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className="btn btn-primary">Añadir</button>
        </form>
        <div className="stack" style={{ gap: 6 }}>
          {data.hooks.map((h) => (
            <div key={h.id} className="unit">
              <div><div>{h.text}</div><div className="small faint">{h.type} · {h.source}</div></div>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/hooks/${h.id}`).then(load)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Ganchos usados en tus vídeos</h2>
        {!data.used.length && <p className="muted">Aparecerán aquí cuando generes vídeos.</p>}
        <table className="t">
          <tbody>{data.used.map((u) => <tr key={u.versionId}><td>{u.text || <span className="faint">sin texto</span>}</td><td className="small muted">{u.type}</td><td className="small">{u.project}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Ideas() {
  const [rows, setRows] = useState<{ id: string; text: string; status: string }[]>([]);
  const [text, setText] = useState("");
  const load = useCallback(() => void api.get<typeof rows>("/api/ideas").then(setRows), []);
  useEffect(load, [load]);
  return (
    <div className="card">
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); void api.post("/api/ideas", { text }).then(() => { setText(""); load(); }); }}>
        <input type="text" required placeholder="Idea para un próximo vídeo" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary">Guardar idea</button>
      </form>
      {!rows.length && <p className="muted">Apunta aquí ideas de vídeos para no olvidarlas (reparaciones curiosas, preguntas de clientes, comparativas…).</p>}
      <div className="stack" style={{ gap: 6 }}>
        {rows.map((r) => (
          <div key={r.id} className="unit">
            <div>{r.text}</div>
            <div className="row">
              <select value={r.status} onChange={(e) => api.patch(`/api/ideas/${r.id}`, { status: e.target.value }).then(load)} style={{ width: "auto" }}>
                {["pendiente", "grabada", "publicada", "descartada"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/ideas/${r.id}`).then(load)}><Icon name="trash" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metrics() {
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [rows, setRows] = useState<{ id: string; project: string; platform: string; posted_at: string | null; data: Record<string, number> }[]>([]);
  const [ins, setIns] = useState<{ total: number; note: string; groups: { group: string; n: number; avgViews: number | null; avgCompletion: number | null; avgInquiries: number | null }[] } | null>(null);
  const [f, setF] = useState<Record<string, string>>({ projectId: "", platform: "instagram", postedAt: "" });
  const load = useCallback(() => {
    void api.get<typeof rows>("/api/metrics").then(setRows);
    void api.get<typeof ins>("/api/insights").then(setIns);
  }, []);
  useEffect(() => {
    load();
    void api.get<ProjectRow[]>("/api/projects").then((p) => setProjects(p.filter((x) => x.lastVersionId)));
  }, [load]);
  const fields: [string, string][] = [["views", "Visualizaciones"], ["avgWatchSeconds", "Tiempo medio (s)"], ["retention3s", "Retención 3 s (%)"], ["completionRate", "Finalización (%)"], ["likes", "Me gusta"], ["comments", "Comentarios"], ["shares", "Compartidos"], ["saves", "Guardados"], ["inquiries", "Consultas"], ["profileVisits", "Visitas al perfil"]];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="notice small">No hay integración automática con Instagram, TikTok ni YouTube: introduce las métricas que veas en cada plataforma. Solo se usan tus datos reales.</div>
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(fields.filter(([k]) => f[k] !== undefined && f[k] !== "").map(([k]) => [k, Number(f[k])]));
          try {
            await api.post("/api/metrics", { projectId: f.projectId, platform: f.platform, postedAt: f.postedAt || undefined, data });
            setF({ projectId: f.projectId, platform: f.platform, postedAt: "" });
            toast("Métricas guardadas");
            load();
          } catch (e2) {
            toast(e2 instanceof ApiError ? e2.message : "Error");
          }
        }}
      >
        <h2>Añadir resultados de una publicación</h2>
        <div className="grid grid-3">
          <label className="field">Vídeo<select required value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">Elige un proyecto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field">Plataforma<select value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option><option value="otra">Otra</option></select></label>
          <label className="field">Fecha de publicación<input type="date" value={f.postedAt} onChange={(e) => setF({ ...f, postedAt: e.target.value })} /></label>
        </div>
        <div className="grid grid-3">
          {fields.map(([k, l]) => <label key={k} className="field">{l}<input type="number" min={0} step="any" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}
        </div>
        <div><button className="btn btn-primary" disabled={!f.projectId}>Guardar</button></div>
      </form>
      {ins && (
        <div className="card">
          <div className="card-head"><h2>Qué funciona en tu cuenta</h2><span className="small muted">{ins.total} publicación(es) con datos</span></div>
          <p className="small" style={{ color: "var(--warn)", marginBottom: 10 }}>{ins.note}</p>
          {ins.groups.length > 0 && (
            <table className="t">
              <thead><tr><th>Característica</th><th>n</th><th>Visualizaciones medias</th><th>Finalización media</th><th>Consultas medias</th></tr></thead>
              <tbody>{ins.groups.map((g) => <tr key={g.group}><td>{g.group}</td><td className="mono">{g.n}</td><td className="mono">{g.avgViews != null ? Math.round(g.avgViews) : "—"}</td><td className="mono">{g.avgCompletion != null ? `${g.avgCompletion.toFixed(1)} %` : "—"}</td><td className="mono">{g.avgInquiries != null ? g.avgInquiries.toFixed(1) : "—"}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}
      {rows.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Historial</h2>
          <table className="t">
            <thead><tr><th>Vídeo</th><th>Plataforma</th><th>Fecha</th><th>Visualizaciones</th><th></th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.project}</td><td>{r.platform}</td><td>{r.posted_at ?? "—"}</td><td className="mono">{r.data.views ?? "—"}</td><td><button className="btn btn-sm btn-ghost btn-danger" onClick={() => api.del(`/api/metrics/${r.id}`).then(load)}><Icon name="trash" /></button></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
