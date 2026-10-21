import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, fmtDate, fmtDur, fmtUsd } from "../api";
import { StageList } from "../components/StageList";
import { CopyButton, Icon, StatusBadge, usePoll, useToast } from "../components/ui";
import type { ProjectDetail, VersionDetail } from "../types";
import { LABELS } from "../types";

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [v, setV] = useState<VersionDetail | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    api.get<ProjectDetail>(`/api/projects/${id}`).then(setP, (e) => setErr(e instanceof ApiError ? e.message : "Error"));
  }, [id]);
  useEffect(load, [load]);
  const active = !!p?.job && (p.job.status === "queued" || p.job.status === "running");
  usePoll(load, active, 1200);
  const versionId = sp.get("v") ?? p?.versions[0]?.id;
  useEffect(() => {
    if (!versionId) return setV(null);
    api.get<VersionDetail>(`/api/versions/${versionId}`).then(setV, () => setV(null));
  }, [versionId, p?.versions.length]);

  if (err) return <div className="notice err">{err}</div>;
  if (!p) return null;

  const action = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Error");
    }
  };
  const failedStage = p.job?.stages.find((s) => s.status === "failed");

  return (
    <div className="fade">
      <div className="page-head">
        <div>
          <div className="row"><h1>{p.name}</h1><StatusBadge status={p.status} /></div>
          <p className="muted small">Creado {fmtDate(p.createdAt)} · {p.assets.filter((a) => a.kind === "video").length} clip(s) · perfil {p.profileId}</p>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => action(async () => { const r = await api.post<{ id: string }>(`/api/projects/${p.id}/duplicate`); nav(`/proyectos/${r.id}`); }, "Proyecto duplicado")}><Icon name="dup" />Duplicar</button>
          <button className="btn btn-sm" disabled={active} onClick={() => action(() => api.post(`/api/projects/${p.id}/generate`), "Generación iniciada")}><Icon name="refresh" />Regenerar</button>
        </div>
      </div>

      {(active || (p.job && p.job.status === "failed")) && (
        <div className="card">
          <div className="card-head">
            <h2>{active ? (p.job!.type === "generate" ? "Generando tu vídeo" : "Aplicando cambios") : "El proceso se detuvo"}</h2>
            {active && <span className="small muted">Puedes cerrar esta página: el trabajo sigue en el servidor.</span>}
          </div>
          {p.job!.status === "failed" && (
            <div className="notice err" style={{ marginBottom: 12 }}>
              <b>{failedStage?.label ?? "Error"}:</b> {failedStage?.message ?? p.job!.error}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn btn-sm btn-primary" onClick={() => action(() => api.post(`/api/jobs/${p.job!.id}/retry`), "Reintentando desde la etapa que falló")}><Icon name="refresh" />Reintentar</button>
                <span className="small muted">Se reanuda desde la última etapa completada, sin repetir el resto.</span>
              </div>
              {failedStage?.detail?.log && <details style={{ marginTop: 8 }}><summary className="small muted">Registro técnico</summary><pre className="small" style={{ whiteSpace: "pre-wrap" }}>{failedStage.detail.log}</pre></details>}
            </div>
          )}
          <StageList stages={p.job!.stages} />
        </div>
      )}

      {v && (
        <>
          {p.versions.length > 1 && (
            <div className="row" style={{ marginBottom: 14 }}>
              {p.versions.map((x) => (
                <button key={x.id} className={`btn btn-sm ${x.id === v.id ? "btn-primary" : ""}`} onClick={() => setSp({ v: x.id })}>
                  v{x.n} · {x.label}{p.acceptedVersion === x.id ? " ✓" : ""}
                </button>
              ))}
            </div>
          )}
          <Result p={p} v={v} disabled={active} onAction={action} />
        </>
      )}
      {!v && !active && p.job?.status !== "failed" && (
        <div className="card empty">
          Este proyecto aún no tiene vídeo. <Link to="/" className="muted">Sube clips</Link> o pulsa «Regenerar».
        </div>
      )}
    </div>
  );
}

function Result({ p, v, disabled, onAction }: { p: ProjectDetail; v: VersionDetail; disabled: boolean; onAction: (fn: () => Promise<unknown>, ok: string) => void }) {
  const plan = v.plan;
  const pack = v.pack;
  const accepted = p.acceptedVersion === v.id;
  return (
    <div className="result">
      <div className="stack">
        <div className="player">{v.hasVideo ? <video src={`/api/versions/${v.id}/video`} controls playsInline poster={v.hasCover ? `/api/versions/${v.id}/cover` : undefined} /> : <div className="empty">Vídeo no disponible</div>}</div>
        <div className="grid grid-2">
          <a className="btn btn-primary" href={`/api/versions/${v.id}/video?download=1`}><Icon name="download" />Vídeo MP4</a>
          <a className="btn" href={`/api/versions/${v.id}/cover?download=1`}><Icon name="download" />Portada</a>
          <a className="btn" href={`/api/versions/${v.id}/package`}><Icon name="download" />Paquete .zip</a>
          <a className="btn" href={`/api/versions/${v.id}/srt`}><Icon name="download" />Subtítulos .srt</a>
        </div>
        <div className="grid grid-2">
          <Link className={`btn ${disabled ? "disabled" : ""}`} to={`/proyectos/${p.id}/revision/${v.id}`}><Icon name="edit" />Revisar y corregir</Link>
          <button className={`btn ${accepted ? "" : "btn-primary"}`} disabled={accepted} onClick={() => onAction(() => api.post(`/api/versions/${v.id}/accept`), "Resultado aceptado")}>
            <Icon name="check" />{accepted ? "Aceptado" : "Aceptar resultado"}
          </button>
        </div>
        <div className="card">
          <h3>Generar una variación</h3>
          <p className="small muted" style={{ margin: "4px 0 10px" }}>Reutiliza todo el análisis: solo se vuelve a montar.</p>
          <div className="row">
            <button className="btn btn-sm" disabled={disabled} onClick={() => onAction(() => api.post(`/api/versions/${v.id}/variation`, { kind: "gancho" }), "Variación de gancho en marcha")}>Otro gancho</button>
            <button className="btn btn-sm" disabled={disabled} onClick={() => onAction(() => api.post(`/api/versions/${v.id}/variation`, { kind: "ritmo" }), "Variación de ritmo en marcha")}>Otro ritmo</button>
          </div>
        </div>
      </div>
      <div className="stack" style={{ gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <h2>Pack de publicación</h2>
            <span className={`badge ${pack.source === "ia" ? "accent" : ""}`}>{pack.source === "ia" ? "Redactado por IA" : "Plantilla sin IA"}</span>
          </div>
          <div className="stack">
            <div>
              <div className="small muted">Títulos propuestos</div>
              {pack.titles.map((t) => <div className="copy-row" key={t}><div>{t}</div><CopyButton text={t} /></div>)}
            </div>
            <div>
              <div className="small muted">Descripción</div>
              <div className="copy-row"><div style={{ whiteSpace: "pre-wrap" }}>{pack.description}</div><CopyButton text={`${pack.description}\n\n${pack.hashtags.map((h) => h.tag).join(" ")}`} /></div>
            </div>
            <div>
              <div className="small muted">Hashtags (con motivo)</div>
              <div>{pack.hashtags.map((h) => <span className="tag" key={h.tag} title={h.why}>{h.tag}</span>)}</div>
            </div>
            <dl className="kv">
              <dt>Llamada a la acción</dt><dd>{pack.cta}</dd>
              <dt>Frase de portada</dt><dd>{pack.coverText}</dd>
              <dt>Gancho</dt><dd>{pack.hookSummary}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Qué se ha hecho</h2>
          <dl className="kv" style={{ marginBottom: 12 }}>
            <dt>Duración</dt><dd className="mono">{fmtDur(v.duration)}</dd>
            <dt>Objetivo</dt><dd>{LABELS.objective[plan.objective as keyof typeof LABELS.objective] ?? plan.objective}</dd>
            <dt>Tema</dt><dd>{plan.topic}</dd>
            <dt>Ritmo</dt><dd>{LABELS.intensity[plan.intensity as keyof typeof LABELS.intensity] ?? plan.intensity}</dd>
            <dt>IA</dt><dd>{plan.ai.used ? `${plan.ai.model} · ${fmtUsd(plan.ai.costUsd)}` : "No usada"} <span className="faint small">{plan.ai.note}</span></dd>
          </dl>
          <ul className="clean">{plan.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          {plan.warnings.length > 0 && (
            <div className="notice warn" style={{ marginTop: 12 }}>
              <b>Avisos</b>
              <ul className="clean">{plan.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </div>
        {plan.hook && (
          <div className="card">
            <h2 style={{ marginBottom: 10 }}>Ganchos evaluados</h2>
            <table className="t">
              <thead><tr><th>Fragmento</th><th>Tipo</th><th>Puntuación</th><th>Motivo</th></tr></thead>
              <tbody>
                {plan.hook.candidates.map((c) => {
                  const u = plan.units.find((x) => x.id === c.unitId);
                  const label = u ? `${u.clipName} · ${fmtDur(u.start)}` : c.unitId;
                  return (
                  <tr key={c.unitId}>
                    <td className="small">{c.unitId === plan.hook!.unitId ? <b>{label} ✓</b> : label}</td>
                    <td>{c.type}</td>
                    <td className="mono">{Math.round(c.total * 100)}</td>
                    <td className="small">{c.why}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {v.qc && (
          <div className="card">
            <div className="card-head"><h2>Control de calidad</h2><span className={`badge ${v.qc.passed ? "ok" : "err"}`}>{v.qc.passed ? "Superado" : "Con problemas"}</span></div>
            <div className="stack" style={{ gap: 6 }}>
              {v.qc.checks.map((c) => (
                <div key={c.id} className="row small" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                  <span style={{ color: c.ok ? "var(--ok)" : c.severity === "error" ? "var(--err)" : "var(--warn)" }}>{c.ok ? "✓" : "!"}</span>
                  <div><b style={{ fontWeight: 550 }}>{c.label}</b> <span className="muted">· {c.detail}</span></div>
                </div>
              ))}
            </div>
            <p className="faint small" style={{ marginTop: 10 }}>Comprobación técnica del archivo. No garantiza que cumpla las especificaciones vigentes de cada plataforma.</p>
          </div>
        )}
      </div>
    </div>
  );
}
