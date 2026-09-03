import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AuthGate } from '../auth/AuthGate';
import { AthleteWorkspace } from '../features/athletes/AthleteWorkspace';
import { appRoutes, type AppRoute } from './routes';

function EmptyWorkspace({ route }: { route: AppRoute }) {
  return (
    <section className="workspace" aria-labelledby="workspace-title">
      <header className="workspace-heading">
        <div>
          <h1 id="workspace-title">{route.label}</h1>
          <p>{route.description}</p>
        </div>
        <button type="button" className="primary-action" disabled>Sincronizar ciclista</button>
      </header>
      <div className="athlete-strip" role="status">
        <div className="athlete-initial">—</div>
        <div><strong>Selecciona un ciclista</strong><span>Los análisis se mantienen vacíos hasta elegirlo.</span></div>
        <span className="quality-label">Sin datos</span>
      </div>
      <div className="analysis-stage">
        <div className="metabolic-trace" aria-hidden="true">
          <span /><span /><span /><span /><span /><span /><span />
        </div>
        <div className="empty-copy">
          <h2>Empieza por la identidad del análisis</h2>
          <p>Elige un ciclista y un periodo. Después podrás revisar qué datos son medidos, estimados o incompletos.</p>
          <button type="button">Elegir ciclista</button>
        </div>
        <aside aria-label="Criterios de análisis">
          <p><strong>Periodo</strong><span>Sin definir</span></p>
          <p><strong>Deporte</strong><span>Ciclismo</span></p>
          <p><strong>Calidad</strong><span>Pendiente</span></p>
        </aside>
      </div>
    </section>
  );
}

function Application() {
  return (
    <div className="app-layout">
      <aside className="navigation-shell">
        <a className="brand" href="/" aria-label="MFPP Metabolic Lab, inicio">
          <span className="brand-symbol" aria-hidden="true">M</span>
          <span><strong>MFPP</strong><small>Metabolic Lab</small></span>
        </a>
        <nav aria-label="Navegación principal">
          {appRoutes.map((route) => (
            <NavLink key={route.path} to={route.path} end={route.path === '/'}>{route.shortLabel}</NavLink>
          ))}
        </nav>
        <p className="nav-note">Los resultados experimentales requieren confirmación profesional.</p>
      </aside>
      <main className="main-area">
        <Routes>
          {appRoutes.map((route) => <Route key={route.path} path={route.path} element={route.path === '/' ? <AthleteWorkspace /> : <EmptyWorkspace route={route} />} />)}
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  return <AuthGate><BrowserRouter><Application /></BrowserRouter></AuthGate>;
}
