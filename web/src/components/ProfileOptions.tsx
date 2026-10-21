import type { Profile } from "../types";
import { LABELS } from "../types";
import { Seg } from "./ui";

/** Opciones profesionales de un perfil (ocultas por defecto en la pantalla principal). */
export function ProfileOptions({ value, onChange, musicTracks }: { value: Profile; onChange: (p: Profile) => void; musicTracks?: string[] }) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="grid grid-2">
        <label className="field">
          Intensidad de los cortes
          <Seg value={value.cutIntensity} options={Object.entries(LABELS.intensity) as [Profile["cutIntensity"], string][]} onChange={(v) => set("cutIntensity", v)} />
        </label>
        <label className="field">
          Modo de procesamiento
          <Seg value={value.processing} options={Object.entries(LABELS.processing) as [Profile["processing"], string][]} onChange={(v) => set("processing", v)} />
          <span className="faint small">
            {value.processing === "economico" ? "Sin IA de pago: análisis local y plantillas." : value.processing === "equilibrado" ? "IA solo para elegir escenas y redactar textos (una llamada, si está configurada)." : "Más fotogramas analizados por la IA; coste potencialmente mayor."}
          </span>
        </label>
      </div>
      <div className="grid grid-3">
        <label className="field">
          Estilo de subtítulos
          <select value={value.subtitleStyle} onChange={(e) => set("subtitleStyle", e.target.value as Profile["subtitleStyle"])}>
            {Object.entries(LABELS.subtitle).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          Tipo de gancho
          <select value={value.hookStyle} onChange={(e) => set("hookStyle", e.target.value as Profile["hookStyle"])}>
            {Object.entries(LABELS.hook).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          Duración objetivo (segundos, 0 = automática)
          <input type="number" min={0} max={600} value={value.targetDuration} onChange={(e) => set("targetDuration", Number(e.target.value))} />
        </label>
      </div>
      <div className="grid grid-3">
        <label className="field">
          Voz en off
          <select value={value.voiceover.mode} onChange={(e) => set("voiceover", { ...value.voiceover, mode: e.target.value as Profile["voiceover"]["mode"] })}>
            {Object.entries(LABELS.voiceMode).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          Voz
          <select value={value.voiceover.voice} onChange={(e) => set("voiceover", { ...value.voiceover, voice: e.target.value as "femenina" | "masculina" })}>
            <option value="femenina">Femenina</option>
            <option value="masculina">Masculina</option>
          </select>
        </label>
        <label className="field">
          Velocidad de la voz ({value.voiceover.speed.toFixed(2)}×)
          <input type="range" min={0.8} max={1.3} step={0.05} value={value.voiceover.speed} onChange={(e) => set("voiceover", { ...value.voiceover, speed: Number(e.target.value) })} />
        </label>
      </div>
      <div className="grid grid-3">
        <label className="field">
          Estilo de narración
          <select value={value.voiceover.style} onChange={(e) => set("voiceover", { ...value.voiceover, style: e.target.value as Profile["voiceover"]["style"] })}>
            <option value="informativo">Informativo</option>
            <option value="dinamico">Dinámico para redes</option>
            <option value="comercial">Comercial</option>
          </select>
        </label>
        <label className="field">
          Música
          <select value={value.music.enabled ? value.music.track ?? "" : "__off"} onChange={(e) => set("music", e.target.value === "__off" ? { ...value.music, enabled: false } : { ...value.music, enabled: true, track: e.target.value || undefined })}>
            <option value="__off">Sin música</option>
            <option value="">Automática (de mi biblioteca)</option>
            {musicTracks?.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          Volumen de la música ({value.music.volumeDb} dB)
          <input type="range" min={-36} max={-8} step={1} value={value.music.volumeDb} onChange={(e) => set("music", { ...value.music, volumeDb: Number(e.target.value) })} />
        </label>
      </div>
      <div className="grid grid-3">
        <label className="field">
          Reencuadre a vertical
          <select value={value.reframe} onChange={(e) => set("reframe", e.target.value as Profile["reframe"])}>
            {Object.entries(LABELS.reframe).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="field">
          Resolución de salida
          <select value={`${value.export.width}x${value.export.height}`} onChange={(e) => { const [w, h] = e.target.value.split("x").map(Number); set("export", { ...value.export, width: w, height: h }); }}>
            <option value="1080x1920">1080 × 1920 (9:16, recomendado)</option>
            <option value="720x1280">720 × 1280 (9:16, más ligero)</option>
            <option value="1080x1350">1080 × 1350 (4:5)</option>
            <option value="1080x1080">1080 × 1080 (1:1)</option>
            <option value="1920x1080">1920 × 1080 (16:9)</option>
          </select>
        </label>
        <label className="field">
          Calidad de exportación
          <select value={value.export.quality} onChange={(e) => set("export", { ...value.export, quality: e.target.value as Profile["export"]["quality"] })}>
            <option value="borrador">Borrador (rápido)</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta (más lento)</option>
          </select>
        </label>
      </div>
      <div className="grid grid-3">
        <label className="field">
          Fotogramas por segundo
          <select value={String(value.export.fps)} onChange={(e) => set("export", { ...value.export, fps: e.target.value === "origen" ? "origen" : Number(e.target.value) })}>
            <option value="origen">Como el material original</option>
            <option value="30">30 fps</option>
            <option value="60">60 fps</option>
            <option value="25">25 fps</option>
          </select>
        </label>
        <label className="field" style={{ gridColumn: "span 2" }}>
          Llamada a la acción (vacío = la de tu marca)
          <input type="text" maxLength={200} value={value.cta} placeholder="Ej.: Pide presupuesto por WhatsApp" onChange={(e) => set("cta", e.target.value)} />
        </label>
      </div>
      <div className="row" style={{ gap: 20 }}>
        <label className="check"><input type="checkbox" checked={value.zoom === "moderado"} onChange={(e) => set("zoom", e.target.checked ? "moderado" : "ninguno")} />Zoom moderado en los cortes</label>
        <label className="check"><input type="checkbox" checked={value.highlightKeywords} onChange={(e) => set("highlightKeywords", e.target.checked)} />Resaltar palabras clave</label>
        <label className="check"><input type="checkbox" checked={value.hookText} onChange={(e) => set("hookText", e.target.checked)} />Texto del gancho en pantalla</label>
      </div>
    </div>
  );
}
