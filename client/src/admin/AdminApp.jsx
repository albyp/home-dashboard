import { useEffect, useState } from 'react';
import { usePoll } from '../api.js';
import { Dot, Link } from './parts.jsx';
import Overview from './Overview.jsx';
import Service from './Service.jsx';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import './admin.css';

// Swatch colours are each theme's tone and CTA
const THEMES = [
  { id: 'auto', name: 'Auto (sage by day, moss by night)' },
  { id: 'sage', name: 'Sage', a: '#4f6d56', b: '#7b3f8c' },
  { id: 'powder', name: 'Powder', a: '#8fb3d9', b: '#e2725b' },
  { id: 'moss', name: 'Moss', a: '#191f1a', b: '#d4a5e0' },
  { id: 'terminal', name: 'Terminal', a: '#1e1e2e', b: '#cba6f7' }
];
const THEME_KEY = 'hd-theme';

function savedTheme() {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return THEMES.some(x => x.id === t) ? t : 'auto';
  } catch {
    return 'auto';
  }
}

function worst(problems) {
  if (problems?.some(p => p.level === 'bad')) return 'bad';
  if (problems?.some(p => p.level === 'warn')) return 'warn';
  return 'ok';
}

function NavList({ label, items, path }) {
  if (!items?.length) return null;
  return (
    <nav className="navgroup list" aria-label={label}>
      <div className="navlabel">{label}</div>
      {items.map(s => (
        <Link key={s.id} to={`/s/${s.id}`} className={`nav${path === `/s/${s.id}` ? ' active' : ''}`}>
          <Dot status={s.status} label={`${s.name}: ${s.status}`} />
          {s.name}
          {s.host && <span className="host">{s.host}</span>}
        </Link>
      ))}
    </nav>
  );
}

function ThemePicker({ theme, setTheme }) {
  return (
    <div className="themes" role="group" aria-label="Theme">
      {THEMES.map(t => (
        <button
          key={t.id}
          type="button"
          className={t.id === 'auto' ? 'auto' : ''}
          style={t.a ? { '--a': t.a, '--b': t.b } : undefined}
          aria-pressed={theme === t.id}
          aria-label={t.name}
          title={t.name}
          onClick={() => setTheme(t.id)}
        />
      ))}
    </div>
  );
}

export default function AdminApp({ path }) {
  const overview = usePoll('/api/overview', 15000);
  const data = overview.data;
  const [theme, setTheme] = useState(savedTheme);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.className = 'admin-root';
    root.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* private window */ }
  }, [theme]);

  // Close the phone menu after moving to another page
  useEffect(() => setMenuOpen(false), [path]);

  useEffect(() => {
    const bad = data?.problems?.filter(p => p.level === 'bad').length;
    document.title = `${bad ? `(${bad}) ` : ''}${data?.title || 'home-dashboard'}`;
  }, [data]);

  const serviceId = path.match(/^\/s\/([a-z0-9-]+)/)?.[1];
  const status = worst(data?.problems);

  return (
    <div className="shell">
      <aside className={`side${menuOpen ? ' open' : ''}`}>
        <div className="side-top">
          <Link to="/" className="brand">
            <div className="brand-mark">{(data?.host || 'h')[0]}</div>
            <div><b>{data?.host || 'home'}</b><small>{data?.title || 'home-dashboard'}</small></div>
          </Link>
          <button type="button" className="menu-btn" aria-expanded={menuOpen} aria-controls="side-nav" onClick={() => setMenuOpen(o => !o)}>
            <Dot status={status} label="Overall status" />
            <span className="bars" aria-hidden="true" />
            Menu
          </button>
        </div>
        <div className="side-nav" id="side-nav">
          <nav className="navgroup">
            <Link to="/" className={`nav${!serviceId ? ' active' : ''}`}><Dot status={status} label="Overall status" />Overview</Link>
          </nav>
          <NavList label="Apps" items={data?.sidebar?.apps} path={path} />
          <NavList label="Tools" items={data?.sidebar?.tools} path={path} />
        </div>
        <div className="side-foot">
          <ThemePicker theme={theme} setTheme={setTheme} />
          <div className="side-links">
            <a href="/kiosk">Kiosk view</a>
            <form method="post" action="/logout"><button type="submit" className="linkbtn">Log out</button></form>
          </div>
        </div>
      </aside>
      <main className="main">
        {serviceId ? <Service id={serviceId} /> : <Overview poll={overview} />}
      </main>
    </div>
  );
}
