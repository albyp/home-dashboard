import Docker from 'dockerode';
import { cached } from '../lib/cache.js';

// Docker on each host is read through a read-only socket proxy
// (linuxserver/socket-proxy with CONTAINERS=1, POST=0). Never the raw socket.
const clients = new Map();

function client(endpoint) {
  if (!clients.has(endpoint)) {
    const u = new URL(endpoint.replace(/^tcp:/, 'http:'));
    clients.set(endpoint, new Docker({ host: u.hostname, port: Number(u.port || 2375), protocol: 'http', timeout: 4000 }));
  }
  return clients.get(endpoint);
}

export function getContainers(host) {
  if (!host.docker) return null;
  return cached(`docker:${host.name}`, async () => {
    const list = await client(host.docker).listContainers({ all: true });
    return list
      .filter(c => c.Labels?.['dashboard.hide'] !== 'true')
      .map(c => ({
        name: c.Names[0].replace(/^\//, ''),
        image: c.Image,
        state: c.State,
        status: c.Status,
        health: c.Status.match(/\((healthy|unhealthy|health: starting)\)/)?.[1] || null,
        project: c.Labels?.['com.docker.compose.project'] || null,
        created: c.Created
      }));
  });
}
