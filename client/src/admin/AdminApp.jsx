import { useEffect } from 'react';
import { usePoll } from '../api.js';
import { Dot, Link } from './parts.jsx';
import Overview from './Overview.jsx';
import Service from './Service.jsx';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import './admin.css';

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

export default function AdminApp({ path }) {
  const overview = usePoll('/api/overview', 15000);
  const data = overview.data;

  useEffect(() => {
    document.documentElement.className = 'admin-root';
  }, []);

  useEffect(() => {
    const bad = data?.problems?.filter(p => p.level === 'bad').length;
    document.title = `${bad ? `(${bad}) ` : ''}${data?.title || 'home-dashboard'}`;
  }, [data]);

  const serviceId = path.match(/^\/s\/([a-z0-9-]+)/)?.[1];

  return (
    <div className="shell">
      <aside className="side">
        <Link to="/" className="brand">
          <div className="brand-mark">{(data?.host || 'h')[0]}</div>
          <div><b>{data?.host || 'home'}</b><small>{data?.title || 'home-dashboard'}</small></div>
        </Link>
        <nav className="navgroup">
          <Link to="/" className={`nav${!serviceId ? ' active' : ''}`}><Dot status={worst(data?.problems)} label="Overall status" />Overview</Link>
        </nav>
        <NavList label="Apps" items={data?.sidebar?.apps} path={path} />
        <NavList label="Tools" items={data?.sidebar?.tools} path={path} />
        <div className="side-foot">
          <a href="/kiosk">Kiosk view</a>
          <form method="post" action="/logout"><button type="submit" className="linkbtn">Log out</button></form>
        </div>
      </aside>
      <main className="main">
        {serviceId ? <Service id={serviceId} /> : <Overview poll={overview} />}
      </main>
    </div>
  );
}
