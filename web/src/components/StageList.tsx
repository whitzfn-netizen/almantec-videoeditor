import { fmtUsd } from "../api";
import type { Stage } from "../types";

export function StageList({ stages }: { stages: Stage[] }) {
  return (
    <div className="stages">
      {stages.map((s) => {
        const pct = s.detail?.fraction !== undefined ? s.detail.fraction : s.detail?.total ? (s.detail.done ?? 0) / s.detail.total : null;
        return (
          <div key={s.id} className={`stage ${s.status}`}>
            <div className="stage-icon">{s.status === "done" ? "✓" : s.status === "failed" ? "!" : s.status === "skipped" ? "–" : ""}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.label}</div>
              <div className="small muted">{s.message ?? s.what}</div>
              {s.status === "running" && pct !== null && <div className="progress"><i style={{ width: `${Math.round(pct * 100)}%` }} /></div>}
              {s.status === "failed" && s.detail?.help && <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>Qué hacer: {s.detail.help}</div>}
            </div>
            <div className="stage-meta">
              {s.provider && s.status !== "pending" && <span className="badge">{s.provider}</span>}
              {s.status === "done" && s.mayCost && (s.costUsd ? <span className="badge warn">{fmtUsd(s.costUsd)}</span> : !s.costKnown ? <span className="badge warn">coste desconocido</span> : null)}
              {s.status === "pending" && s.mayUseExternal && <span className="badge" title="Puede usar un proveedor externo si está configurado">externo opcional</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
