import si from 'systeminformation';
import os from 'os';
import fs from 'fs';
import { cached } from '../lib/cache.js';

// Live stats for the host the dashboard runs on (host networking, shared kernel).
// Other hosts' stats come from their host agent.
const history = []; // [timestamp, cpu%], one point per 5 minutes, 6 hours
const HISTORY_POINTS = 72;

function readTemp() {
  try {
    return Math.round(parseInt(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8'), 10) / 100) / 10;
  } catch {
    return null;
  }
}

export function getLocalStats() {
  return cached('system', async () => {
    const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
    const cpu = Math.round(load.currentLoad);
    const now = Date.now();
    if (!history.length || now - history[history.length - 1][0] >= 5 * 60 * 1000) {
      history.push([now, cpu]);
      if (history.length > HISTORY_POINTS) history.shift();
    }
    return {
      cpu,
      cores: os.cpus().length,
      load: os.loadavg().map(l => Math.round(l * 100) / 100),
      ram: { used: mem.active, total: mem.total },
      temp: readTemp(),
      uptime: os.uptime(),
      cpuHistory: history.map(p => p[1])
    };
  }, 10000);
}
