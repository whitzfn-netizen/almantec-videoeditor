import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api } from "./api";
import { Icon } from "./components/ui";
import Create from "./pages/Create";
import Intel from "./pages/Intel";
import Login from "./pages/Login";
import Project from "./pages/Project";
import Projects from "./pages/Projects";
import Review from "./pages/Review";
import Settings from "./pages/Settings";

export default function App() {
  const [session, setSession] = useState<{ authenticated: boolean; authEnabled: boolean } | null>(null);
  useEffect(() => {
    const load = () => api.get<{ authenticated: boolean; authEnabled: boolean }>("/api/session").then(setSession, () => setSession({ authenticated: false, authEnabled: true }));
    load();
    const out = () => setSession((s) => (s ? { ...s, authenticated: false } : s));
    window.addEventListener("avs:logout", out);
    return () => window.removeEventListener("avs:logout", out);
  }, []);
  if (!session) return null;
  if (!session.authenticated) return <Login onDone={() => setSession({ ...session, authenticated: true })} />;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">A</div>
          <div>
            <b>AlmanTec</b>
            <span>Viral Studio AI</span>
          </div>
        </div>
        <nav className="nav stack" style={{ gap: 2 }}>
          <NavLink to="/" end><Icon name="plus" />Crear vídeo</NavLink>
          <NavLink to="/proyectos"><Icon name="folder" />Mis proyectos</NavLink>
          <NavLink to="/inteligencia"><Icon name="spark" />Inteligencia</NavLink>
          <NavLink to="/configuracion"><Icon name="gear" />Configuración</NavLink>
        </nav>
        <div className="side-foot small faint">
          {session.authEnabled ? (
            <button className="btn btn-ghost btn-sm" onClick={() => api.post("/api/logout").then(() => setSession({ ...session, authenticated: false }))}>Cerrar sesión</button>
          ) : (
            <span className="badge warn">Sin contraseña</span>
          )}
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Create />} />
          <Route path="/proyectos" element={<Projects />} />
          <Route path="/proyectos/:id" element={<Project />} />
          <Route path="/proyectos/:id/revision/:versionId" element={<Review />} />
          <Route path="/inteligencia" element={<Intel />} />
          <Route path="/configuracion" element={<Settings />} />
          <Route path="*" element={<div className="empty">Página no encontrada</div>} />
        </Routes>
      </main>
    </div>
  );
}
