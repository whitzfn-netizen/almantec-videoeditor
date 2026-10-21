import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const paths: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  upload: "M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  gear: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h5l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3",
  download: "M12 4v12m0 0l-4-4m4 4l4-4M4 18v1a1 1 0 001 1h14a1 1 0 001-1v-1",
  play: "M7 4l13 8-13 8z",
  pause: "M7 4h4v16H7zM13 4h4v16h-4z",
  refresh: "M4 4v6h6M20 20v-6h-6M5.5 15A8 8 0 0019 17.5M18.5 9A8 8 0 005 6.5",
  copy: "M9 9h10v10H9zM5 15V5h10",
  edit: "M4 20h4L18.5 9.5a2.1 2.1 0 00-4-4L4 16v4z",
  check: "M5 12l5 5L20 7",
  wand: "M15 4V2M15 10V8M11 6h2M17 6h2M4 20L14 10M18 2l-1 1",
  x: "M6 6l12 12M18 6L6 18",
  dup: "M8 8h12v12H8zM4 16V4h12",
};

export function Icon({ name, size }: { name: keyof typeof paths | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d={paths[name] ?? ""} />
    </svg>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ["", "Borrador"], queued: ["accent", "En cola"], processing: ["accent", "Procesando"], done: ["ok", "Terminado"], failed: ["err", "Con errores"],
  };
  const [cls, label] = map[status] ?? ["", status];
  return <span className={`badge ${cls}`}><span className="dot" />{label}</span>;
}

/** Sondeo periódico mientras `active` sea verdadero. */
export function usePoll(fn: () => void, active: boolean, ms = 1500) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }, [fn, active, ms]);
}

export function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <button className="btn btn-ghost btn-sm" title="Copiar" onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copiado al portapapeles"), () => toast("No se pudo copiar"))}>
      <Icon name="copy" />
    </button>
  );
}
