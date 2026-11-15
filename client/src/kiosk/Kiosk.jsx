import { useEffect, useRef, useState } from 'react';
import { usePoll, kioskAction } from '../api.js';
import { Icon, WeatherIcon, Bin } from './icons.jsx';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/500.css';
import '@fontsource/figtree/600.css';
import '@fontsource/bricolage-grotesque/500.css';
import '@fontsource/bricolage-grotesque/700.css';
import './kiosk.css';

const okv = v => v && !v.error;
const TABS = [['today', 'Today', 'calendar'], ['house', 'House', 'house'], ['watch', 'Watch', 'tv'], ['system', 'System', 'shield']];
const IDLE_MS = 3 * 60 * 1000; // go back to Today after 3 minutes untouched

function readTab() {
  try { return localStorage.getItem('kiosk.tab') || 'today'; } catch { return 'today'; }
}

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Keep the screen awake while the kiosk is open, where the browser allows it
function useWakeLock() {
  useEffect(() => {
    let lock = null;
    const request = () => navigator.wakeLock?.request('screen').then(l => { lock = l; }).catch(() => {});
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); lock?.release?.(); };
  }, []);
}

const time12 = d => {
  const h = d.getHours() % 12 || 12;
  return { hm: `${h}:${String(d.getMinutes()).padStart(2, '0')}`, ap: d.getHours() >= 12 ? 'pm' : 'am' };
};
const timeOf = iso => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
const dayName = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'short' });

function Header({ weather, now }) {
  const t = time12(now);
  return (
    <header className="k-top">
      <div>
        <div className="k-clock">{t.hm}<small>{t.ap}</small></div>
        <div className="k-date">{now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>
      {okv(weather) && (
        <div className="k-weather">
          <div className="k-wnow">
            <WeatherIcon icon={weather.now.icon} className="k-wicon" />
            <div>
              <b>{weather.now.temp}°</b>
              <span>{weather.now.text} · {weather.today.max}° / {weather.today.min}°{weather.now.uvMax >= 6 ? ` · UV ${weather.now.uvMax}` : ''}</span>
            </div>
          </div>
          <div className="k-days">
            {weather.days.map(d => (
              <div className="k-day" key={d.date}><small>{dayName(d.date)}</small><WeatherIcon icon={d.icon} className="k-dicon" /><b>{d.max}°</b> <i>{d.min}°</i></div>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}

// ---------- Today ----------
function Agenda({ events }) {
  if (!events) return null;
  const today = new Date().toDateString();
  const now = Date.now();
  const groups = [['Today', []], ['Tomorrow', []]];
  if (okv(events) || Array.isArray(events)) {
    for (const e of events) {
      const d = new Date(e.allDay ? `${e.start}T12:00:00` : e.start);
      groups[d.toDateString() === today ? 0 : 1][1].push(e);
    }
  }
  return (
    <article className="k-card k-agenda">
      <div className="k-eyebrow">Family calendar</div>
      {events.error ? <p className="k-hint">{events.error}</p> : (
        <ol>
          {groups.map(([label, items], gi) => (
            <li key={label} className="k-group">
              {gi > 0 && <div className="k-dayhead">{label}</div>}
              {items.length === 0 && <p className="k-hint">{gi === 0 ? 'Nothing else today' : 'Nothing planned'}</p>}
              {items.map(e => {
                const nowish = !e.allDay && new Date(e.start) - now < 30 * 60000 && new Date(e.end) > now;
                return (
                  <div key={e.id} className={`k-event${nowish ? ' now' : ''}`}>
                    <time>{e.allDay ? 'All day' : timeOf(e.start)}</time>
                    <div>{e.title}{e.location && <span>{e.location}</span>}</div>
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

function Tasks({ lists, reload }) {
  const [listId, setListId] = useState(null);
  const [pending, setPending] = useState({});
  const [error, setError] = useState(null);
  if (!lists) return null;
  if (lists.error) return <article className="k-card k-tasks"><div className="k-eyebrow">To-do</div><p className="k-hint">{lists.error}</p></article>;
  const list = lists.find(l => l.id === listId) || lists[0];
  if (!list) return null;

  const toggle = async task => {
    const done = !(pending[task.id] ?? task.done);
    setPending(p => ({ ...p, [task.id]: done }));
    setError(null);
    try {
      await kioskAction({ action: 'task', list: list.id, id: task.id, done });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(p => { const { [task.id]: _, ...rest } = p; return rest; });
    }
  };

  const dueLabel = due => {
    if (!due) return null;
    const d = new Date(due.slice(0, 10) + 'T12:00:00');
    const days = Math.round((d - new Date().setHours(12, 0, 0, 0)) / 86400000);
    if (days < 0) return 'Overdue';
    if (days === 0) return 'Due today';
    if (days === 1) return 'Due tomorrow';
    return `Due ${d.toLocaleDateString('en-AU', { weekday: 'short' })}`;
  };

  return (
    <article className="k-card k-tasks">
      <div className="k-eyebrow">To-do</div>
      {lists.length > 1 && (
        <div className="k-listpick" role="tablist" aria-label="Task lists">
          {lists.map(l => (
            <button key={l.id} type="button" role="tab" aria-selected={l.id === list.id} className={l.id === list.id ? 'on' : ''} onClick={() => setListId(l.id)}>
              {l.name}<span className="k-count">{l.items.filter(i => !i.done).length}</span>
            </button>
          ))}
        </div>
      )}
      {list.items.length === 0 ? <p className="k-hint">Nothing on this list.</p> : (
        <ul>
          {list.items.map(t => {
            const done = pending[t.id] ?? t.done;
            const due = dueLabel(t.due);
            return (
              <li key={t.id}>
                <label>
                  <input type="checkbox" id={`task-${t.id}`} checked={done} disabled={t.id in pending} onChange={() => toggle(t)} />
                  <span className="k-t">{t.title}{(due || (done && t.completedAt)) && <small>{done ? 'Done' : due}</small>}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="k-error">{error}</p>}
      <p className="k-hint">Add tasks in Google Tasks on your phone.</p>
    </article>
  );
}

const BIN_COLOURS = { red: 'var(--bin-red)', yellow: 'var(--bin-yellow)', green: 'var(--bin-green)', blue: 'var(--bin-blue)', grey: 'var(--muted)' };

function Bins({ bins }) {
  if (!bins?.streams?.length) return null;
  const label = bins.tonight ? 'Bins out tonight' : bins.isToday ? 'Bins collected today' : `Next bins · ${new Date(`${bins.date}T12:00:00`).toLocaleDateString('en-AU', { weekday: 'long' })}`;
  const [main, ...rest] = bins.streams.filter(s => s.name !== 'General waste').concat(bins.streams.filter(s => s.name === 'General waste'));
  return (
    <article className={`k-card k-bins${bins.tonight ? ' tonight' : ''}`}>
      <div className="k-binicons">{bins.streams.map(s => <Bin key={s.name} colour={BIN_COLOURS[s.colour] || s.colour} />)}</div>
      <div>
        <div className="k-eyebrow">{label}</div>
        <h2>{main.name}</h2>
        {rest.length > 0 && <p className="k-hint">and {rest.map(s => s.name.toLowerCase()).join(', ')}</p>}
      </div>
    </article>
  );
}

function People({ people }) {
  if (!people) return null;
  return (
    <article className="k-card">
      <div className="k-eyebrow">Who's home</div>
      {people.error ? <p className="k-hint">{people.error}</p> : (
        <div className="k-people">
          {people.map(p => (
            <div key={p.name} className={`k-person${p.home ? ' home' : ''}`}>
              <div className="k-avatar">{p.name[0]}</div>
              <div><b>{p.name}</b><span>{p.place}{!p.home && p.since ? ` · since ${timeOf(p.since)}` : ''}</span></div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Dinner({ dinner }) {
  if (dinner === null || dinner === undefined) return null;
  return (
    <article className="k-card k-dinner">
      <div className="k-eyebrow">Tonight's dinner</div>
      {dinner.error ? <p className="k-hint">{dinner.error}</p> : (
        <>
          <h2>{dinner.title}</h2>
          <div className="k-facts">{dinner.minutes && <span>{dinner.minutes} min</span>}{dinner.servings && <span>Serves {dinner.servings}</span>}</div>
        </>
      )}
    </article>
  );
}

function Nothing({ dinner }) {
  return dinner === null ? <article className="k-card k-dinner"><div className="k-eyebrow">Tonight's dinner</div><p className="k-hint">Nothing planned in Tandoor yet.</p></article> : null;
}

// ---------- House ----------
function useAction(reload) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (key, body) => {
    setBusy(key);
    setError(null);
    try {
      await kioskAction(body);
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run };
}

function House({ house, reload }) {
  const { busy, error, run } = useAction(reload);
  const [lastScene, setLastScene] = useState(null);
  if (!house) return <EmptyTab text="The house controls are not set up." />;
  if (house.error) return <EmptyTab text={house.error} />;
  return (
    <section className="k-panel k-house">
      {error && <p className="k-error k-wide">{error}</p>}
      {house.scenes?.length > 0 && (
        <article className="k-card k-wide">
          <div className="k-eyebrow">Scenes</div>
          <div className="k-scenes">
            {house.scenes.map(s => (
              <button key={s.id} type="button" className={`k-btn${lastScene === s.id ? ' on' : ''}`} disabled={busy === s.id}
                onClick={() => { setLastScene(s.id); run(s.id, { action: 'scene', id: s.id }); }}>
                {s.name}
              </button>
            ))}
          </div>
        </article>
      )}
      {house.lights?.length > 0 && (
        <article className="k-card">
          <div className="k-eyebrow">Lights</div>
          <div className="k-lights">
            {house.lights.map(l => (
              <button key={l.id} type="button" aria-pressed={l.on} className={`k-btn${l.on ? ' on' : ''}`} disabled={busy === l.id} onClick={() => run(l.id, { action: 'light', id: l.id })}>
                {l.name}<small>{l.on ? `On${l.brightness ? ` · ${l.brightness}%` : ''}` : 'Off'}</small>
              </button>
            ))}
          </div>
        </article>
      )}
      {house.climate?.map(c => (
        <article className="k-card k-climate" key={c.id}>
          <div className="k-eyebrow">{c.name}</div>
          <div className="k-temp">{c.mode === 'off' ? 'Off' : `${c.target ?? '—'}°`}<small>{c.mode !== 'off' && c.action ? ` ${c.action}` : ''}{c.current != null ? ` · inside ${c.current}°` : ''}</small></div>
          <div className="k-stepper">
            <button type="button" className="k-btn" disabled={busy === c.id || (c.mode !== 'off' && c.target <= c.min)} onClick={() => run(c.id, { action: 'climate', id: c.id, value: -0.5 })}>Cooler</button>
            <button type="button" className="k-btn" disabled={busy === c.id || (c.mode !== 'off' && c.target >= c.max)} onClick={() => run(c.id, { action: 'climate', id: c.id, value: 0.5 })}>Warmer</button>
          </div>
          {c.mode !== 'off' && <button type="button" className="k-btn" disabled={busy === c.id} onClick={() => run(c.id, { action: 'climate', id: c.id, value: 'off' })}>Turn off</button>}
        </article>
      ))}
      {house.humidors?.length > 0 && (
        <article className="k-card">
          <div className="k-eyebrow">Humidors</div>
          {house.humidors.map(h => <div className="k-humi" key={h.name}><span>{h.name}</span><b>{h.humidity ?? '—'}%</b></div>)}
          <p className="k-hint">
            {house.humidors.every(h => h.ok) ? <span className="k-ok">All in range</span> : <span className="k-warn">{house.humidors.filter(h => !h.ok).map(h => `${h.name} ${h.label}`).join(' · ')}</span>}
            {house.humidorRange ? ` · ${house.humidorRange[0]}–${house.humidorRange[1]}% target` : ''}
          </p>
        </article>
      )}
    </section>
  );
}

// ---------- Watch ----------
function Poster({ item, index }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="k-poster">
      <div className={`k-art a${(index % 4) + 1}`}>
        {!failed && <img src={`/api/kiosk/poster/${item.id}`} alt="" onError={() => setFailed(true)} />}
        <i style={{ width: `${item.progress}%` }} />
      </div>
      <b>{item.title}</b>
      <span>{item.detail}{item.minutesLeft ? ` · ${item.minutesLeft} min left` : ''}</span>
    </div>
  );
}

function Watch({ media }) {
  const { resume, requests } = media || {};
  if (!resume && !requests) return <EmptyTab text="Jellyfin and Seerr are not set up." />;
  return (
    <section className="k-panel k-watch">
      {resume && (
        <article className="k-card">
          <div className="k-eyebrow">Keep watching</div>
          {resume.error ? <p className="k-hint">{resume.error}</p> : resume.length === 0 ? <p className="k-hint">Nothing half-watched.</p> : (
            <div className="k-posters">{resume.slice(0, 8).map((r, i) => <Poster key={r.id} item={r} index={i} />)}</div>
          )}
        </article>
      )}
      {requests && (
        <article className="k-card">
          <div className="k-eyebrow">Requests</div>
          {requests.error ? <p className="k-hint">{requests.error}</p> : requests.length === 0 ? <p className="k-hint">No requests yet.</p> : (
            <ul className="k-reqs">{requests.map((r, i) => <li key={i}><span>{r.title}</span><span className={`k-badge${r.ready ? ' ready' : ''}`}>{r.status}</span></li>)}</ul>
          )}
          <p className="k-hint">To ask for something new, use Seerr on your phone.</p>
        </article>
      )}
    </section>
  );
}

// ---------- System ----------
function System({ system }) {
  if (!system) return <EmptyTab text="System status is not set up." />;
  return (
    <section className="k-panel k-system">
      <article className={`k-card k-status ${system.level}`}>
        <div className="k-ring" aria-hidden="true" />
        <div><h2>{system.headline}</h2><p>{system.message}</p></div>
      </article>
      <article className="k-card k-wide">
        <div className="k-eyebrow">Services</div>
        <ul className="k-svcs">
          {system.services.map(s => <li key={s.name} className={s.ok === false ? 'w' : s.ok === null ? 'u' : ''}>{s.name}<span>{s.note}</span></li>)}
        </ul>
        <p className="k-hint">The full admin view is on the dashboard, not on this screen.</p>
      </article>
    </section>
  );
}

const EmptyTab = ({ text }) => <section className="k-panel"><article className="k-card k-wide"><p className="k-hint">{text}</p></article></section>;

export default function Kiosk() {
  const { data, error, reload } = usePoll('/api/kiosk', 30000);
  const [tab, setTab] = useState(readTab);
  const now = useClock();
  const idle = useRef(null);
  useWakeLock();

  useEffect(() => {
    document.documentElement.className = 'kiosk-root';
    document.title = 'Home';
  }, []);

  useEffect(() => {
    try { localStorage.setItem('kiosk.tab', tab); } catch { /* private mode */ }
    clearTimeout(idle.current);
    if (tab !== 'today') idle.current = setTimeout(() => setTab('today'), IDLE_MS);
    return () => clearTimeout(idle.current);
  }, [tab]);

  // Any touch restarts the idle timer
  useEffect(() => {
    const reset = () => {
      clearTimeout(idle.current);
      if (tab !== 'today') idle.current = setTimeout(() => setTab('today'), IDLE_MS);
    };
    window.addEventListener('pointerdown', reset);
    return () => window.removeEventListener('pointerdown', reset);
  }, [tab]);

  const sysDot = data?.system && data.system.level !== 'ok' && data.system.level !== 'unknown';

  return (
    <div className="k-app">
      {data?.demo && <span className="k-flag">Demo data</span>}
      <Header weather={data?.weather} now={now} />
      <div className="k-panels">
        {!data ? <p className="k-hint">{error ? `Can't reach the dashboard: ${error}` : 'Loading…'}</p> : (
          <>
            {tab === 'today' && (
              <section className="k-panel k-today">
                <Agenda events={data.calendar} />
                <Tasks lists={data.tasks} reload={reload} />
                <div className="k-stack">
                  <Bins bins={data.bins} />
                  <People people={data.people} />
                  <Dinner dinner={data.dinner} />
                  <Nothing dinner={data.dinner} />
                </div>
              </section>
            )}
            {tab === 'house' && <House house={data.house} reload={reload} />}
            {tab === 'watch' && <Watch media={data.media} />}
            {tab === 'system' && <System system={data.system} />}
          </>
        )}
      </div>
      <nav className="k-tabbar" aria-label="Kiosk sections">
        {TABS.map(([id, label, icon]) => (
          <button key={id} type="button" className={tab === id ? 'on' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon name={icon} />{label}
            {id === 'system' && sysDot && <span className={`k-sysdot ${data.system.level}`} aria-label="Something needs attention" />}
          </button>
        ))}
      </nav>
    </div>
  );
}
