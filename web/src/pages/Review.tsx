import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError, fmtDur } from "../api";
import { Icon, useToast } from "../components/ui";
import type { Profile, VersionDetail } from "../types";
import { LABELS } from "../types";

const t2 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

export default function Review() {
  const { id, versionId } = useParams<{ id: string; versionId: string }>();
  const nav = useNavigate();
  const toast = useToast();
  const [v, setV] = useState<VersionDetail | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [voice, setVoice] = useState<"" | "femenina" | "masculina">("");
  const [voiceMode, setVoiceMode] = useState<"" | Profile["voiceover"]["mode"]>("");
  const [style, setStyle] = useState<"" | Profile["subtitleStyle"]>("");
  const [hookText, setHookText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    api.get<VersionDetail>(`/api/versions/${versionId}`).then((x) => {
      setV(x);
      setInclude(Object.fromEntries(x.plan.units.map((u) => [u.id, u.include])));
    });
  }, [versionId]);

  const captions = v?.captions?.captions ?? [];
  const changedUnits = useMemo(() => (v ? v.plan.units.filter((u) => include[u.id] !== u.include) : []), [v, include]);
  const dirty = changedUnits.length > 0 || Object.keys(edits).length > 0 || !!voice || !!style || !!voiceMode || hookText !== null;

  if (!v) return null;
  const keyOf = (c: (typeof captions)[number]) => c.words.map((w) => w.w).join(" ");
  const seek = (t: number) => {
    if (video.current) {
      video.current.currentTime = t;
      void video.current.play();
    }
  };

  async function rerender() {
    if (!v) return;
    setBusy(true);
    try {
      const ov = v.plan.overrides ?? { include: [], exclude: [] };
      const inc = new Set(ov.include);
      const exc = new Set(ov.exclude);
      for (const u of changedUnits) {
        if (include[u.id]) {
          inc.add(u.id);
          exc.delete(u.id);
        } else {
          exc.add(u.id);
          inc.delete(u.id);
        }
      }
      await api.post(`/api/versions/${v.id}/rerender`, {
        overrides: changedUnits.length ? { include: [...inc], exclude: [...exc] } : undefined,
        captionEdits: Object.keys(edits).length ? edits : undefined,
        voice: voice || undefined,
        voiceoverMode: voiceMode || undefined,
        subtitleStyle: style || undefined,
        hookText: hookText ?? undefined,
      });
      toast("Volviendo a exportar con tus cambios (se reutiliza el análisis)");
      nav(`/proyectos/${id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="fade">
      <div className="page-head">
        <div>
          <Link to={`/proyectos/${id}?v=${v.id}`} className="small muted">← Volver al resultado</Link>
          <h1 style={{ marginTop: 4 }}>Revisión rápida · v{v.n}</h1>
          <p className="muted small">Corrige solo lo imprescindible. Al volver a exportar se reutilizan los análisis guardados.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => api.post(`/api/versions/${v.id}/accept`).then(() => toast("Resultado aceptado"))}><Icon name="check" />Aceptar resultado</button>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void rerender()}><Icon name="refresh" />Volver a exportar</button>
        </div>
      </div>
      <div className="review">
        <div className="stack" style={{ position: "sticky", top: 16 }}>
          <div className="player">
            <video ref={video} src={`/api/versions/${v.id}/video`} controls playsInline onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          </div>
          <div className="row">
            <button className="btn" onClick={() => (playing ? video.current?.pause() : void video.current?.play())}><Icon name={playing ? "pause" : "play"} />{playing ? "Pausar" : "Reproducir"}</button>
            <span className="mono muted">{fmtDur(time)} / {fmtDur(v.duration)}</span>
          </div>
          <div className="card stack">
            <label className="field">
              Texto del gancho
              <input type="text" maxLength={60} value={hookText ?? v.plan.hook?.text ?? ""} onChange={(e) => setHookText(e.target.value)} placeholder="Sin texto" />
            </label>
            <label className="field">
              Estilo de subtítulos
              <select value={style} onChange={(e) => setStyle(e.target.value as Profile["subtitleStyle"])}>
                <option value="">Sin cambios</option>
                {Object.entries(LABELS.subtitle).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <div className="grid grid-2">
              <label className="field">
                Voz en off
                <select value={voiceMode} onChange={(e) => setVoiceMode(e.target.value as Profile["voiceover"]["mode"])}>
                  <option value="">Sin cambios</option>
                  {Object.entries(LABELS.voiceMode).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="field">
                Voz
                <select value={voice} onChange={(e) => setVoice(e.target.value as "femenina" | "masculina")}>
                  <option value="">Sin cambios</option>
                  <option value="femenina">Femenina</option>
                  <option value="masculina">Masculina</option>
                </select>
              </label>
            </div>
          </div>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          <div className="card">
            <div className="card-head"><h2>Subtítulos</h2><span className="small muted">Pulsa el tiempo para ir a ese punto</span></div>
            {!captions.length && <p className="muted">Este vídeo no tiene subtítulos.</p>}
            <div className="stack" style={{ gap: 2 }}>
              {captions.map((c, i) => {
                const k = keyOf(c);
                return (
                  <div key={i} className={`cap ${time >= c.start && time < c.end ? "now" : ""}`}>
                    <button className="time" onClick={() => seek(c.start)}>{t2(c.start)}</button>
                    <input type="text" maxLength={200} value={edits[k] ?? c.text ?? k} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Fragmentos</h2><span className="small muted">{v.plan.units.filter((u) => include[u.id]).length} de {v.plan.units.length} incluidos</span></div>
            <div className="stack" style={{ gap: 8 }}>
              {v.plan.units.map((u) => (
                <div key={u.id} className={`unit ${include[u.id] ? "" : "off"}`}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row small"><b>{u.clipName}</b><span className="mono muted">{t2(u.start)}–{t2(u.end)}</span><span className="badge">{u.kind}</span>{u.id === v.plan.hook?.unitId && <span className="badge accent">gancho</span>}</div>
                    <div className="small" style={{ marginTop: 2 }}>{u.description}</div>
                    <div className="small faint">{u.reason}</div>
                  </div>
                  <button className={`btn btn-sm ${include[u.id] ? "btn-danger" : ""}`} onClick={() => setInclude({ ...include, [u.id]: !include[u.id] })}>
                    {include[u.id] ? "Eliminar" : "Recuperar"}
                  </button>
                </div>
              ))}
            </div>
          </div>
          <details className="pro">
            <summary>Registro de segmentos eliminados ({v.plan.removed.length})</summary>
            <div className="pro-body">
              <table className="t">
                <thead><tr><th>Clip</th><th>Tramo</th><th>Motivo</th></tr></thead>
                <tbody>
                  {v.plan.removed.map((r) => (
                    <tr key={r.id}><td className="small">{r.clipName}</td><td className="mono small">{t2(r.start)}–{t2(r.end)}</td><td className="small">{r.reason}{r.text ? <div className="faint">«{r.text}»</div> : null}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="faint small" style={{ marginTop: 8 }}>Los silencios y pausas no se recuperan uno a uno: si un corte te parece agresivo, usa el ritmo «Suave» en las opciones profesionales.</p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
