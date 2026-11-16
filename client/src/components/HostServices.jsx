import React from 'react';
import { FiExternalLink } from 'react-icons/fi';
import ServiceIcon from './ServiceIcon';
import { DockerApps } from './DockerStatus';
import { formatSpeed, localUrl, timeAgo } from '../format';

function Details({ svc, offline }) {
  const d = svc.details;
  if (offline) return <span className="muted">machine offline</span>;
  if (!svc.up) return <span className="muted">{svc.error || 'down'}</span>;
  if (!d) return <span className="muted">{svc.latency}ms</span>;
  if (svc.kind === 'jellyfin' && d.version) return <span className="muted">v{d.version} · {svc.latency}ms</span>;
  if (svc.kind === 'qbittorrent') {
    if (d.dlSpeed == null) return <span className="muted">{svc.latency}ms{d.needsAuth ? ' · add creds for stats' : ''}</span>;
    return (
      <span className="muted">
        ↓ {formatSpeed(d.dlSpeed)} · ↑ {formatSpeed(d.upSpeed)} · {d.activeTorrents} active
      </span>
    );
  }
  return <span className="muted">{svc.latency}ms</span>;
}

function headerMeta(host, containers) {
  if (host.offline) {
    const seen = host.tailscale?.lastSeen ? ` · seen ${timeAgo(host.tailscale.lastSeen)}` : '';
    return <span className="muted">offline{seen}</span>;
  }
  const up = host.services.filter(s => s.up).length;
  const running = containers ? containers.filter(c => c.state === 'running').length : 0;
  const total = host.services.length + (containers?.length || 0);
  return `${up + running}/${total} up`;
}

// One card per machine: its Docker containers (this machine only, for now) and its
// native services. An offline machine (rocky is often off) shows grey, not red.
export default function HostServices({ data, docker }) {
  if (!data) return <section className="widget">Loading services...</section>;
  if (data.error || !Array.isArray(data)) {
    return (
      <section className="widget">
        <h2>Machines</h2>
        <div className="widget-error">{data.error || 'Unavailable'}</div>
      </section>
    );
  }

  return (
    <>
      {data.map(host => {
        const containers = host.local && Array.isArray(docker) ? docker : null;
        return (
          <section key={host.host} className={`widget host-services${host.offline ? ' offline' : ''}${containers?.length ? ' wide' : ''}`}>
            <h2>
              <span><span className={`dot ${host.offline ? 'grey' : 'green'}`} /> {host.name}</span>
              <span className="h2-meta">{headerMeta(host, containers)}</span>
            </h2>
            {host.description && <div className="widget-desc">{host.description}</div>}
            {host.local && docker?.error && <div className="widget-error">Docker unavailable: {docker.error}</div>}
            {containers && <DockerApps containers={containers} />}
            {host.services.length > 0 && (
              <div className="service-list">
                {host.services.map(svc => {
                  const href = host.local ? localUrl(svc) : svc.url;
                  const dot = host.offline ? 'grey' : svc.up ? 'green' : 'red';
                  return (
                    <a key={svc.name + svc.port} className="service-row" href={href} target="_blank" rel="noopener noreferrer">
                      <ServiceIcon hint={svc.kind || svc.name} />
                      <div className="service-body">
                        <div className="service-name">
                          <span className={`dot ${dot}`} />
                          {svc.name}
                          <span className="muted mono"> :{svc.port}</span>
                        </div>
                        <Details svc={svc} offline={host.offline} />
                      </div>
                      <FiExternalLink className="app-open" aria-hidden="true" />
                    </a>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
