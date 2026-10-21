import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, fmtDate } from "../api";
import { Icon, StatusBadge, usePoll, useToast } from "../components/ui";
import type { ProjectRow } from "../types";

export default function Projects() {
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [filter, setFilter] = useState("todos");
  const nav = useNavigate();
  const toast = useToast();
  const load = useCallback(() => void api.get<ProjectRow[]>("/api/projects").then(setRows), []);
  useEffect(load, [load]);
  usePoll(load, !!rows?.some((r) => r.status === "processing" || r.status === "queued"), 3000);
  if (!rows) return null;
  const shown = rows.filter((r) => filter === "todos" || r.status === filter);
  return (
    <div className="fade">
      <div className="page-head">
        <div>
          <h1>Mis proyectos</h1>
          <p className="muted">{rows.length} proyecto(s)</p>
        </div>
        <div className="seg">
          {[["todos", "Todos"], ["processing", "En proceso"], ["done", "Terminados"], ["failed", "Con errores"], ["draft", "Borradores"]].map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {!shown.length && <div className="card empty">No hay proyectos aquí todavía. <Link to="/" style={{ color: "var(--accent)" }}>Crea el primero</Link>.</div>}
      <div className="grid grid-auto">
        {shown.map((r) => (
          <div key={r.id} className="card proj fade">
            <Link to={`/proyectos/${r.id}`} className="proj-thumb">{r.hasThumb ? <img src={`/api/projects/${r.id}/thumb`} alt="" loading="lazy" /> : <Icon name="film" size={28} />}</Link>
            <div className="proj-body">
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <Link to={`/proyectos/${r.id}`} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</Link>
                <StatusBadge status={r.status} />
              </div>
              <div className="small muted">{fmtDate(r.updatedAt)} · {r.clips} clip(s){r.accepted ? " · aceptado" : ""}</div>
              {r.error && <div className="small" style={{ color: "var(--err)" }}>{r.error}</div>}
              <div className="row" style={{ marginTop: "auto" }}>
                <Link className="btn btn-sm" to={`/proyectos/${r.id}`}>Abrir</Link>
                {r.lastVersionId && <a className="btn btn-sm" href={`/api/versions/${r.lastVersionId}/package`} title="Descargar paquete"><Icon name="download" /></a>}
                <button className="btn btn-sm" title="Duplicar" onClick={async () => { const x = await api.post<{ id: string }>(`/api/projects/${r.id}/duplicate`); nav(`/proyectos/${x.id}`); }}><Icon name="dup" /></button>
                <span className="spacer" />
                <button
                  className="btn btn-sm btn-ghost btn-danger"
                  title="Borrar proyecto y archivos"
                  onClick={async () => {
                    if (!confirm(`¿Borrar «${r.name}» y todos sus archivos? No se puede deshacer.`)) return;
                    try {
                      await api.del(`/api/projects/${r.id}`);
                      toast("Proyecto borrado");
                      load();
                    } catch (e) {
                      toast(e instanceof ApiError ? e.message : "Error");
                    }
                  }}
                ><Icon name="trash" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
