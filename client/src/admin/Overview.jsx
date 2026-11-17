import { useTick } from '../api.js';
import { ago, since, usedOf, duration, when, pct, n } from '../format.js';
import { Area, Chip, Dot, Link, Ring, Spark, Ticks, Unavailable } from './parts.jsx';
import { SunChart, sunVerdict, hm12 } from '../sun.jsx';

const okv = v => v && !v.error;

// Today's sun, until the solar system and the Daikin are in Home Assistant
function Solar({ s }) {
  if (!s) return null;
  if (s.error) return <Area title="Sun today"><Unavailable what="The solar forecast" error={s.error} /></Area>;
  const v = sunVerdict(s);
  const t = s.today;
  return (
    <Area title="Sun today" summary={`${hm12(t.sunrise)} – ${hm12(t.sunset)} · forecast from Open-Meteo`}>
      <article className="card solar">
        <div className="solar-head">
          <div className={`solar-verdict ${v.level}`}>
            <h3>{v.title}</h3>
            <p>{v.detail}</p>
          </div>
          <dl className="solar-facts">
            <div><dt>Strong sun</dt><dd>{t.window ? `${hm12(t.window.start)}–${hm12(t.window.end)}` : 'none'}</dd></div>
            <div><dt>Solar noon</dt><dd>{hm12(t.solarNoon)}</dd></div>
            <div><dt>{t.estimateKwh != null ? 'Estimate' : 'Sunlight'}</dt><dd>{t.estimateKwh != null ? `${t.estimateKwh} kWh` : `${t.kwhPerM2} kWh/m²`}</dd></div>
            <div><dt>UV peak</dt><dd>{t.uvMax}</dd></div>
          </dl>
        </div>
        <SunChart s={s} />
        {s.tomorrow && (
          <p className="note card-foot">
            Tomorrow: {s.tomorrow.window ? `strong ${hm12(s.tomorrow.window.start)}–${hm12(s.tomorrow.window.end)}` : 'no strong hours'} · about {s.tomorrow.cloud}% cloud
            {s.tomorrow.estimateKwh != null ? ` · ~${s.tomorrow.estimateKwh} kWh` : ''}
            {s.onPanel ? '' : ' · sunlight on flat ground'}
          </p>
        )}
      </article>
    </Area>
  );
}

function Problems({ problems }) {
  if (!problems?.length) {
    return <div className="allgood"><Dot status="ok" /> Nothing needs attention.</div>;
  }
  return (
    <div className="problems" role="list" aria-label="Problems">
      {problems.map((p, i) => {
        const title = p.link ? <Link to={p.link}><b>{p.title}</b></Link> : <b>{p.title}</b>;
        return (
          <div key={i} className={`prob ${p.level}`} role="listitem">
            <span className="stripe" />
            <span className="pill">{p.level === 'bad' ? 'Down' : 'Warn'}</span>
            <p>{title}{p.detail && <span> · {p.detail}</span>}</p>
            <time>{since(p.since) || ''}</time>
          </div>
        );
      })}
    </div>
  );
}

function HostCard({ h }) {
  if (h.online === false || h.online === null) {
    return (
      <article className="card host offline">
        <div className="card-head"><Dot status={h.online === null ? 'unknown' : 'off'} /><h3>{h.name}</h3><span className="sub">{h.model}</span></div>
        <div className="offline-body">
          <b>{h.online === null ? 'No data yet' : h.sleeps ? 'Asleep' : 'Offline'}</b>
          <span>{h.online === null ? 'Waiting for this host’s agent.' : h.sleeps ? 'Not on Tailscale. Normal when it sleeps.' : `Not on Tailscale${h.lastSeen ? ` ${since(h.lastSeen)}` : ''}.`}</span>
        </div>
        <div className="hostfoot"><span>{h.lastSeen ? `last seen ${ago(h.lastSeen)}` : ''}</span></div>
      </article>
    );
  }
  const gb = v => Math.round((v / 1024 ** 3) * 10) / 10;
  const level = p => (p >= 90 ? 'bad' : p >= 75 ? 'warn' : '');
  const ramPct = h.ram ? (h.ram.used / h.ram.total) * 100 : null;
  return (
    <article className="card host">
      <div className="card-head"><Dot status="ok" /><h3>{h.name}</h3><span className="sub">{h.model}</span></div>
      <div className="metrics">
        <div className="metric"><small>CPU</small><b>{h.cpu ?? '—'}<i>%</i></b>{h.cpu != null && <div className={`bar ${level(h.cpu)}`}><span style={{ width: `${Math.min(100, h.cpu)}%` }} /></div>}</div>
        <div className="metric"><small>RAM</small><b>{h.ram ? gb(h.ram.used) : '—'}<i>/{h.ram ? gb(h.ram.total) : '—'} GB</i></b>{ramPct != null && <div className={`bar ${level(ramPct)}`}><span style={{ width: `${Math.min(100, ramPct)}%` }} /></div>}</div>
        {h.temp != null
          ? <div className="metric"><small>Temp</small><b>{Math.round(h.temp)}<i>°C</i></b><div className={`bar ${h.temp >= 80 ? 'bad' : h.temp >= 70 ? 'warn' : ''}`}><span style={{ width: `${Math.min(100, h.temp)}%` }} /></div></div>
          : <div className="metric"><small>Disk</small><b>{h.diskPercent ?? '—'}<i>%</i></b>{h.diskPercent != null && <div className={`bar ${level(h.diskPercent)}`}><span style={{ width: `${Math.min(100, h.diskPercent)}%` }} /></div>}</div>}
      </div>
      <Spark values={h.cpuHistory} label={`${h.name} CPU over the last 6 hours`} />
      <div className="hostfoot">
        <span>{h.containers ? `${h.containers.running} of ${h.containers.total} containers running` : 'Docker not read'}</span>
        <span>up {duration(h.uptime)}</span>
      </div>
    </article>
  );
}

function Network({ net }) {
  const rows = [];
  if (net.internet) rows.push(['Internet', <><span className={net.internet.up ? 'pos' : 'neg'}>{net.internet.up ? 'up' : 'down'}</span>{net.internet.latencyMs != null && ` · ${net.internet.latencyMs} ms`}</>]);
  if (okv(net.adguard)) {
    rows.push(['DNS queries today', n(net.adguard.queries)]);
    if (net.adguard.topClient) rows.push(['Busiest client', net.adguard.topClient]);
  } else if (net.adguard?.error) rows.push(['AdGuard', <span className="neg">not reachable</span>]);
  if (net.tailscale?.exitNodes?.length) rows.push(['Exit node', net.tailscale.exitNodes.join(', ')]);
  const ag = okv(net.adguard) ? net.adguard : null;
  const ts = net.tailscale;
  if (!rows.length && !ts) return null;
  const down = net.internet && !net.internet.up;
  return (
    <Area title="Network" summary={down ? 'internet down' : 'all fine'}>
      <article className="card">
        {(ag || ts) && (
          <div className="gauges">
            {ag && (
              <Ring value={ag.blockedPercent} label={`AdGuard blocked ${ag.blockedPercent}% of DNS queries`}>
                <b>{ag.blockedPercent}%</b><small>DNS blocked<br />by AdGuard</small>
              </Ring>
            )}
            {ts && (
              <Ring value={ts.online} max={ts.total} label={`${ts.online} of ${ts.total} Tailscale devices online`}>
                <b>{ts.online}<small style={{ display: 'inline' }}> / {ts.total}</small></b><small>Tailscale<br />devices online</small>
              </Ring>
            )}
          </div>
        )}
        {rows.length > 0 && <dl className="kv card-foot">{rows.map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>}
      </article>
    </Area>
  );
}

const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v}</dd></>;

function Storage({ storage, thresholds = { warn: 85 } }) {
  if (!storage.disks.length && !storage.backup) return null;
  const warn = storage.disks.filter(d => d.percent >= thresholds.warn).length;
  return (
    <Area title="Storage" summary={warn ? `${warn} warning${warn > 1 ? 's' : ''}` : 'all fine'}>
      <article className="card">
        {storage.disks.map(d => (
          <div className="disk" key={d.label}>
            <div className="row"><span>{d.label}</span><span>{usedOf(d.used, d.total)}</span></div>
            <div className={`bar${d.percent >= 95 ? ' bad' : d.percent >= thresholds.warn ? ' warn' : ''}`}><span style={{ width: `${Math.min(100, d.percent)}%` }} /></div>
          </div>
        ))}
        {storage.backup && (
          <dl className="kv">
            <Pair k="Last restic backup" v={<><span className={storage.backup.level === 'ok' ? 'pos' : 'neg'}>{storage.backup.result}</span> · {when(storage.backup.lastRun)}{storage.backup.detail ? ` · ${storage.backup.detail}` : ''}</>} />
          </dl>
        )}
      </article>
    </Area>
  );
}

function Health({ health }) {
  if (!health?.length) return null;
  const flagged = health.filter(c => c.level !== 'ok').length;
  return (
    <Area title="System health" summary={`disks, filesystems, backups and OS · ${flagged ? `${flagged} to look at` : 'all fine'}`}>
      <article className="card">
        <table className="checks health">
          <thead><tr><th>Check</th><th>Host</th><th>Last run</th><th>Result</th><th className="n">Detail</th></tr></thead>
          <tbody>
            {health.map(c => (
              <tr key={`${c.host}-${c.id}`}>
                <td className="c-name">{c.name}</td>
                <td className="tag c-host">{c.host}</td>
                <td className="tag c-time">{when(c.lastRun)}</td>
                <td className="c-res"><Chip level={c.level}>{c.result}</Chip></td>
                <td className="n c-det">{c.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </Area>
  );
}

function Repos({ repos }) {
  if (!repos) return null;
  if (repos.error) return <Area title="Repos"><Unavailable what="Repo status" error={repos.error} /></Area>;
  const flagged = repos.filter(r => r.level !== 'ok').length;
  return (
    <Area title="Repos" summary={flagged ? `${flagged} need${flagged === 1 ? 's' : ''} attention` : 'all pushed'}>
      <article className="card">
        <ul className="rows">
          {repos.map(r => (
            <li key={r.name}>
              <Dot status={r.level} />
              <div><b>{r.name}</b><small>{r.branch || '—'}{r.lastPush ? ` · last push ${ago(r.lastPush)}` : ''}</small></div>
              <Chip level={r.level}>{r.state}</Chip>
            </li>
          ))}
        </ul>
      </article>
    </Area>
  );
}

function Syncthing({ st }) {
  if (!st) return null;
  if (st.error) return <Area title="Syncthing"><Unavailable what="Syncthing" error={st.error} /></Area>;
  return (
    <Area title="Syncthing" summary={`${st.devicesOnline} of ${st.devicesTotal} devices online${st.devicesAsleep?.length ? ` · ${st.devicesAsleep.join(', ')} asleep` : ''}`}>
      <article className="card">
        <ul className="rows">
          {st.folders.map(f => (
            <li key={f.id}>
              <Dot status={f.level} />
              <div><b>{f.label}</b><small>{f.devices.join(' · ')}{f.lastChange ? ` · last change ${ago(f.lastChange)}` : ''}</small></div>
              <Chip level={f.level}>{f.state.charAt(0).toUpperCase() + f.state.slice(1)}</Chip>
            </li>
          ))}
        </ul>
      </article>
    </Area>
  );
}

function Checks({ checks }) {
  if (!checks) return null;
  if (checks.error) return <Area title="Apps & tools"><Unavailable what="Gatus" error={checks.error} /></Area>;
  const passing = checks.filter(c => c.status === 'ok').length;
  return (
    <Area title="Apps & tools" summary={`${passing} of ${checks.length} checks passing · last 24 h from Gatus`}>
      <article className="card">
        <table className="checks apps">
          <thead><tr><th>Service</th><th>Host</th><th>Last 24 h</th><th className="n">Uptime</th><th className="n">Response</th></tr></thead>
          <tbody>
            {checks.map(c => (
              <tr key={c.key} className={c.status === 'bad' ? 'down' : ''}>
                <td className="c-svc">
                  {c.serviceId
                    ? <Link className="svc" to={`/s/${c.serviceId}`}><Dot status={c.status} />{c.display}</Link>
                    : <span className="svc"><Dot status={c.status} />{c.display}</span>}
                </td>
                <td className="tag c-host">{c.host || c.group || '—'}</td>
                <td className="c-ticks"><Ticks ticks={c.ticks} /></td>
                <td className="n c-up">{pct(c.uptime24h)}</td>
                <td className="n c-resp">{c.status === 'bad' && c.httpStatus ? c.httpStatus : c.responseMs != null ? `${c.responseMs} ms` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </Area>
  );
}

function Home({ home }) {
  const hum = home?.humidors;
  const bb = home?.betbot;
  if (!hum && !bb) return null;
  const money = c => `${c < 0 ? '−' : '+'}$${(Math.abs(c) / 100).toFixed(2)}`;
  return (
    <Area title="Home">
      <div className="grid2">
        {hum && (
          <article className="card">
            <div className="card-head"><h3>Humidors</h3>{okv(hum) && <span className="sub">target {hum.limits.humidity[0]}–{hum.limits.humidity[1]}% RH</span>}</div>
            {okv(hum) ? (
              <div className="humi">
                {hum.humidors.map(h => {
                  // Scale 40–80 %RH
                  const pos = v => `${Math.min(100, Math.max(0, ((v - 40) / 40) * 100))}%`;
                  return (
                    <div className="gauge" key={h.id}>
                      <div className="big">{h.humidity ?? '—'}<small>% · {h.temperature ?? '—'} °C</small></div>
                      <div className="range" style={{ '--lo': pos(hum.limits.humidity[0]), '--hi': pos(hum.limits.humidity[1]) }}>
                        {h.humidity != null && <b style={{ left: pos(h.humidity) }} />}
                      </div>
                      <div className="scale"><span>40</span><span>{hum.limits.humidity[0]}</span><span>{hum.limits.humidity[1]}</span><span>80</span></div>
                      <small className="note">{h.name} · <span className={h.status.level === 'ok' ? 'pos' : 'neg'}>{h.status.label}</span> · read {ago(h.updated)}</small>
                    </div>
                  );
                })}
              </div>
            ) : <Unavailable what="Humidor readings" error={hum.error} />}
          </article>
        )}
        {bb && (
          <article className="card">
            <div className="card-head"><h3>betbot</h3><span className="sub"><a className="cta-link" href="/betbot/" target="_blank" rel="noopener noreferrer">Open betbot ↗</a></span></div>
            {okv(bb) ? (
              <dl className="kv">
                <Pair k="State" v={bb.live ? 'armed' : 'not armed'} />
                <Pair k="Today" v={<span className={bb.todayPnlCents >= 0 ? 'pos' : 'neg'}>{money(bb.todayPnlCents)}</span>} />
                {bb.sinceArmPnlCents != null && <Pair k="Since armed" v={<span className={bb.sinceArmPnlCents >= 0 ? 'pos' : 'neg'}>{money(bb.sinceArmPnlCents)}</span>} />}
                <Pair k="Open orders" v={bb.openOrders} />
                <Pair k="Recorder" v={bb.recorder || '—'} />
              </dl>
            ) : <Unavailable what="betbot" error={bb.error} />}
          </article>
        )}
      </div>
    </Area>
  );
}

function resetsIn(iso) {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'resetting now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `resets in ${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `resets in ${h}h ${m}m` : `resets in ${m}m`;
}

function UsageRow({ label, w }) {
  if (!w) return null;
  const level = w.utilization >= 90 ? 'bad' : w.utilization >= 70 ? 'warn' : '';
  return (
    <div className="usage">
      <div className="usage-head"><b>{label}</b><small>{w.utilization}% used · {resetsIn(w.resetsAt)}</small></div>
      <div className={`bar ${level}`}><span style={{ width: `${Math.min(100, w.utilization)}%` }} /></div>
    </div>
  );
}

// Claude subscription usage, with a nudge when a window is about to reset mostly unused
function ClaudeCard({ c }) {
  if (!c) return null;
  return (
    <Area title="Claude usage" summary={okv(c) ? (c.stale ? `stale · ${c.stale}` : `checked ${ago(c.fetchedAt)}`) : null}>
      <article className="card">
        {okv(c) ? (
          <>
            {c.nudges.map(nd => (
              <p key={nd.window} className="nudge">Get busy: {nd.unusedPct}% of your {nd.window} limit is unused and it {resetsIn(nd.resetsAt)}.</p>
            ))}
            <UsageRow label="5-hour" w={c.fiveHour} />
            <UsageRow label="Weekly" w={c.sevenDay} />
            <UsageRow label="Weekly (Opus)" w={c.sevenDayOpus} />
            <p className="note card-foot">From Claude Code's usage endpoint (unofficial, may change).</p>
          </>
        ) : <Unavailable what="Claude usage" error={c.error} />}
      </article>
    </Area>
  );
}

// Notes written in the vault today
function VaultCard({ v }) {
  if (!v) return null;
  return (
    <Area title={okv(v) ? `${v.label} today` : 'Vault today'} summary={okv(v) ? `${n(v.notes)} notes` : null}>
      <article className="card">
        {okv(v) ? (
          <>
            <div className="vault-counts"><Chip level="ok">{v.newCount} new</Chip><Chip level="warn">{v.updatedCount} updated</Chip></div>
            {v.recent.length ? (
              <ul className="rows">
                {v.recent.map(r => (
                  <li key={r.folder + r.title}>
                    <Dot status={r.kind === 'new' ? 'ok' : 'warn'} />
                    <div><b>{r.title}</b><small>{r.folder ? `${r.folder} · ` : ''}{ago(r.modified)}</small></div>
                  </li>
                ))}
              </ul>
            ) : <p className="note">Nothing written today yet.</p>}
          </>
        ) : <Unavailable what="The vault" error={v.error} />}
      </article>
    </Area>
  );
}

function Today({ today }) {
  const tiles = [];
  if (today.streams) tiles.push(['Watching now', today.streams.streams, `Jellyfin${today.streams.transcoding ? ` · ${today.streams.transcoding} transcoding` : ''}`]);
  if (today.requests) tiles.push(['Requests waiting', today.requests.pending, 'Seerr']);
  if (today.added) tiles.push(['Added this week', today.added.episodes + today.added.films, `${today.added.episodes} episodes, ${today.added.films} films`]);
  if (!tiles.length && today.uptime == null) return null;
  const up = today.uptime;
  return (
    <Area title="Today & this week">
      <div className="today">
        {tiles.map(([label, value, note]) => (
          <div className="card stat" key={label}><small>{label}</small><span className="big">{value}</span><p>{note}</p></div>
        ))}
        {up != null && (
          <div className="card stat">
            <small>Uptime, last 24 h</small>
            <Ring value={up} max={1} level={up < 0.99 ? 'warn' : ''} label={`Uptime ${pct(up)} across all checks`}>
              <span className="big">{pct(up)}</span><p>across all checks</p>
            </Ring>
          </div>
        )}
      </div>
    </Area>
  );
}

export default function Overview({ poll }) {
  useTick(5000);
  const { data, error, updatedAt } = poll;
  if (!data) {
    return <div className="loading">{error ? `Could not load the overview: ${error}` : 'Loading…'}</div>;
  }
  const hostsUp = data.hosts.filter(h => h.online).length;
  const passing = Array.isArray(data.checks) ? data.checks.length : null;

  return (
    <section className="view">
      <header className="topbar">
        <h1>Overview</h1>
        <div className="meta">
          <span>Updated {ago(new Date(updatedAt).toISOString())}</span>
          {passing != null && <span>Gatus · {passing} checks</span>}
          {error && <span className="neg">Last refresh failed</span>}
          {data.demo && <span className="mockflag">Demo data</span>}
        </div>
      </header>

      <Problems problems={data.problems} />
      <Solar s={data.solar} />

      <Area title="Servers" summary={`${hostsUp} of ${data.hosts.length} online`}>
        <div className="grid3">{data.hosts.map(h => <HostCard key={h.name} h={h} />)}</div>
      </Area>

      <div className="grid2">
        <Network net={data.network} />
        <Storage storage={data.storage} />
      </div>

      <Health health={data.health} />

      <div className="grid2">
        <Repos repos={data.repos} />
        <Syncthing st={data.syncthing} />
      </div>

      <Checks checks={data.checks} />
      <Home home={data.home} />
      {(data.claude || data.vault) && (
        <div className="grid2">
          <ClaudeCard c={data.claude} />
          <VaultCard v={data.vault} />
        </div>
      )}
      <Today today={data.today} />

      <p className="note">Read-only by design: the server only sends GET requests to its sources and never passes their keys to the browser.</p>
    </section>
  );
}
