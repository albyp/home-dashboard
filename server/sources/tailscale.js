import http from 'http';
import { cached } from '../lib/cache.js';

// tailscaled's LocalAPI over its unix socket. The dashboard runs as non-root,
// so the LocalAPI only lets it read status.
function localApi(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path, headers: { Host: 'local-tailscaled.sock' }, timeout: 3000 }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`LocalAPI ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LocalAPI timeout')));
    req.on('error', reject);
  });
}

const ZERO = '0001-01-01T00:00:00Z';

function mapNode(node, isSelf, exitNodeId) {
  return {
    name: (node.DNSName?.split('.')[0] || node.HostName).toLowerCase(),
    os: node.OS,
    online: isSelf || !!node.Online,
    lastSeen: node.LastSeen && node.LastSeen !== ZERO ? node.LastSeen : null,
    exitNodeOption: !!node.ExitNodeOption,
    isExitNode: !!exitNodeId && node.ID === exitNodeId,
    offersExitNode: isSelf && !!node.ExitNodeOption
  };
}

export function getTailscale(config) {
  const src = config.sources.tailscale;
  if (!src) return null;
  return cached('tailscale', async () => {
    const status = await localApi(src.socket || '/var/run/tailscale/tailscaled.sock', '/localapi/v0/status');
    const exitNodeId = status.ExitNodeStatus?.ID || null;
    const self = mapNode(status.Self, true, null);
    const peers = Object.values(status.Peer || {}).map(p => mapNode(p, false, exitNodeId));
    const nodes = [self, ...peers];
    return {
      self: self.name,
      online: nodes.filter(n => n.online).length,
      total: nodes.length,
      // Which node carries exit traffic for others: the one(s) advertising it
      exitNodes: nodes.filter(n => n.exitNodeOption || n.offersExitNode).map(n => n.name),
      nodes
    };
  });
}
