import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError, fmtBytes, fmtDur } from "../api";
import { ProfileOptions } from "../components/ProfileOptions";
import { Icon, useToast } from "../components/ui";
import type { Asset, Profile, ProfileRow, ProjectDetail, ProviderStatus } from "../types";
import { LABELS } from "../types";

const DRAFT_KEY = "avs:draft";
const VIDEO_ACCEPT = ".mp4,.mov,.m4v,.mkv,.webm,.avi,.3gp,.mts,video/*";
const EXTRA_ACCEPT = ".mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.txt,.md,.jpg,.jpeg,.png,.webp,.pdf";

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}
function writeDraft(id: string | null) {
  try {
    if (id) localStorage.setItem(DRAFT_KEY, id);
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export default function Create() {
  const nav = useNavigate();
  const toast = useToast();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [profileId, setProfileId] = useState<string>("");
  const [objective, setObjective] = useState("auto");
  const [custom, setCustom] = useState<Profile | null>(null);
  const [music, setMusic] = useState<string[]>([]);
  const [status, setStatus] = useState<{ providers: ProviderStatus[]; limits: { perVideoUsd: number } } | null>(null);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<{ n: number; f: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const extraRef = useRef<HTMLInputElement>(null);

  const loadProject = useCallback(async (id: string) => {
    try {
      const p = await api.get<ProjectDetail>(`/api/projects/${id}`);
      if (p.status !== "draft") {
        writeDraft(null);
        return setProject(null);
      }
      setProject(p);
    } catch {
      writeDraft(null);
      setProject(null);
    }
  }, []);

  useEffect(() => {
    api.get<ProfileRow[]>("/api/profiles").then((ps) => {
      setProfiles(ps);
      setProfileId((cur) => cur || ps.find((p) => p.isDefault)?.id || ps[0]?.id || "");
    });
    api.get<{ name: string }[]>("/api/library/music").then((m) => setMusic(m.map((x) => x.name)), () => {});
    api.get<{ providers: ProviderStatus[]; limits: { perVideoUsd: number } }>("/api/status").then(setStatus, () => {});
    const d = readDraft();
    if (d) void loadProject(d);
  }, [loadProject]);

  const selected = profiles.find((p) => p.id === profileId);
  const effective: Profile | null = custom ?? selected?.data ?? null;

  async function ensureProject() {
    if (project) return project.id;
    const { id } = await api.post<{ id: string }>("/api/projects", { profileId });
    writeDraft(id);
    return id;
  }

  async function upload(files: File[]) {
    if (!files.length) return;
    setErrors([]);
    try {
      const id = await ensureProject();
      setUploading({ n: files.length, f: 0 });
      const r = await api.upload<{ results: { name: string; ok: boolean; error?: string }[] }>(`/api/projects/${id}/assets`, files, (f) => setUploading({ n: files.length, f }));
      const bad = r.results.filter((x) => !x.ok).map((x) => `${x.name}: ${x.error}`);
      setErrors(bad);
      await loadProject(id);
    } catch (e) {
      setErrors([e instanceof ApiError ? e.message : "Error al subir los archivos"]);
    } finally {
      setUploading(null);
    }
  }

  async function remove(a: Asset) {
    await api.del(`/api/assets/${a.id}`);
    if (project) await loadProject(project.id);
  }

  async function generate() {
    if (!project || !effective) return;
    setBusy(true);
    try {
      const profile = { ...effective, objective };
      await api.patch(`/api/projects/${project.id}`, { profileId, options: { profile } });
      await api.post(`/api/projects/${project.id}/generate`);
      writeDraft(null);
      nav(`/proyectos/${project.id}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "No se pudo iniciar la generación");
      setBusy(false);
    }
  }

  const videos = project?.assets.filter((a) => a.kind === "video") ?? [];
  const extras = project?.assets.filter((a) => a.kind !== "video") ?? [];
  const totalDur = videos.reduce((s, a) => s + (a.duration ?? 0), 0);
  const llm = status?.providers.find((p) => p.id === "anthropic");
  const asr = status?.providers.find((p) => p.kind === "transcripcion" && p.ready);
  const usesAi = effective && effective.processing !== "economico" && llm?.ready;

  return (
    <div className="fade">
      <div className="page-head">
        <div>
          <h1>Crear vídeo</h1>
          <p className="muted">Sube tus clips sin editar, elige un perfil y pulsa el botón. El resto es automático.</p>
        </div>
      </div>

      <div
        className={`drop ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void upload([...e.dataTransfer.files]); }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileRef.current?.click()}
      >
        <div className="drop-icon"><Icon name="upload" /></div>
        <h2>Arrastra aquí tus vídeos</h2>
        <p className="muted" style={{ marginTop: 6 }}>o pulsa para seleccionar varios archivos · MP4, MOV, MKV, WEBM…</p>
        {uploading && (
          <div style={{ maxWidth: 360, margin: "16px auto 0" }}>
            <p className="small">Subiendo {uploading.n} archivo(s)… {Math.round(uploading.f * 100)} %{uploading.f >= 1 ? " · comprobando formato" : ""}</p>
            <div className="progress"><i style={{ width: `${uploading.f * 100}%` }} /></div>
          </div>
        )}
        <input ref={fileRef} type="file" multiple accept={VIDEO_ACCEPT} hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      </div>
      {errors.length > 0 && <div className="notice err" style={{ marginTop: 12 }}>{errors.map((e) => <div key={e}>{e}</div>)}</div>}

      {videos.length > 0 && (
        <div className="files">
          {videos.map((a) => (
            <div className="file fade" key={a.id}>
              {a.hasThumb ? <img src={`/api/assets/${a.id}/thumb`} alt="" /> : <div className="ph">vídeo</div>}
              <div style={{ minWidth: 0 }}>
                <div className="file-name">{a.name}</div>
                <div className="small muted mono">
                  {fmtDur(a.duration)} · {fmtBytes(a.size)}{a.width ? ` · ${a.width}×${a.height}` : ""} · <span style={{ color: "var(--ok)" }}>listo</span>
                </div>
                {a.warnings.length > 0 && <div className="small" style={{ color: "var(--warn)" }}>{a.warnings.join(" · ")}</div>}
              </div>
              <button className="btn btn-ghost btn-sm" title="Quitar clip" onClick={() => void remove(a)}><Icon name="trash" /></button>
            </div>
          ))}
          <div className="row small muted" style={{ justifyContent: "space-between" }}>
            <span>{videos.length} clip(s) · {fmtDur(totalDur)} de material</span>
            <button className="btn btn-ghost btn-sm" onClick={() => extraRef.current?.click()}><Icon name="plus" />Añadir audio, guion o referencias</button>
          </div>
        </div>
      )}
      <input ref={extraRef} type="file" multiple accept={EXTRA_ACCEPT} hidden onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {extras.length > 0 && (
        <div className="files">
          {extras.map((a) => (
            <div className="file" key={a.id}>
              <div className="ph">{a.kind === "audio" ? "audio" : a.kind === "script" ? "guion" : "ref."}</div>
              <div style={{ minWidth: 0 }}>
                <div className="file-name">{a.name}</div>
                <div className="small muted">
                  {a.kind === "audio" ? "Se usará como música de fondo de este vídeo (debe ser tuya o con licencia)" : a.kind === "script" ? "Guion para la voz en off" : "Referencia guardada con el proyecto (no se monta en el vídeo)"}
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" title="Quitar" onClick={() => void remove(a)}><Icon name="trash" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <label className="field">
          Perfil de edición
          <select value={profileId} onChange={(e) => { setProfileId(e.target.value); setCustom(null); }}>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? " (predeterminado)" : ""}</option>)}
          </select>
          {selected && <span className="faint small">{selected.description}</span>}
        </label>
        <label className="field">
          Objetivo del vídeo
          <select value={objective} onChange={(e) => setObjective(e.target.value)}>
            {Object.entries(LABELS.objective).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>

      {effective && (
        <details className="pro" style={{ marginTop: 14 }}>
          <summary>Opciones profesionales {custom && <span className="badge accent">modificadas</span>}</summary>
          <div className="pro-body">
            <ProfileOptions value={effective} onChange={setCustom} musicTracks={music} />
            {custom && <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setCustom(null)}>Restablecer el perfil</button>}
          </div>
        </details>
      )}

      <div style={{ marginTop: 22 }}>
        <button className="btn btn-primary btn-hero" disabled={!videos.length || busy || !!uploading} onClick={() => void generate()}>
          <Icon name="wand" size={22} /> {busy ? "Iniciando…" : "Generar vídeo viral"}
        </button>
        <p className="small muted" style={{ marginTop: 10, textAlign: "center" }}>
          {!asr ? "⚠ Falta el modelo de transcripción: el vídeo saldrá sin subtítulos. " : "Transcripción y voz locales (sin coste). "}
          {usesAi ? `Usará Claude una vez para elegir escenas y textos (límite por vídeo: ${status?.limits.perVideoUsd.toFixed(2)} USD).` : effective?.processing === "economico" ? "Modo económico: sin IA de pago." : "IA de pago no configurada: se usará el análisis automático local."}
        </p>
      </div>
    </div>
  );
}
