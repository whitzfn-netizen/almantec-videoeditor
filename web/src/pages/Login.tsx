import { useState } from "react";
import { api, ApiError } from "../api";

export default function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="login">
      <form
        className="card stack"
        style={{ gap: 16 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr("");
          try {
            await api.post("/api/login", { password: pw });
            onDone();
          } catch (e2) {
            setErr(e2 instanceof ApiError ? e2.message : "No se pudo iniciar sesión");
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="row">
          <div className="brand-mark">A</div>
          <div>
            <h2>AlmanTec Viral Studio AI</h2>
            <p className="muted small">Acceso privado</p>
          </div>
        </div>
        <label className="field">
          Contraseña
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
        </label>
        {err && <div className="notice err">{err}</div>}
        <button className="btn btn-primary" disabled={busy || !pw}>Entrar</button>
      </form>
    </div>
  );
}
