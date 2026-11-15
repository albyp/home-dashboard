import { get, login, probe } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Read-only calls to the apps' own APIs. Each returns null when not configured.
const trim = url => url.replace(/\/$/, '');

export function adguard(config) {
  const src = config.sources.adguard;
  if (!src?.url) return null;
  return cached('adguard', async () => {
    const headers = src.user ? { Authorization: `Basic ${Buffer.from(`${src.user}:${src.password}`).toString('base64')}` } : {};
    const stats = await get(`${trim(src.url)}/control/stats`, { headers });
    const blocked = stats.num_blocked_filtering || 0;
    const top = (stats.top_clients || [])[0];
    return {
      queries: stats.num_dns_queries || 0,
      blockedPercent: stats.num_dns_queries ? Math.round((blocked / stats.num_dns_queries) * 1000) / 10 : 0,
      topClient: top ? Object.keys(top)[0] : null,
      topClients: (stats.top_clients || []).slice(0, 5).map(o => ({ name: Object.keys(o)[0], count: Object.values(o)[0] })),
      topBlocked: (stats.top_blocked_domains || []).slice(0, 5).map(o => ({ name: Object.keys(o)[0], count: Object.values(o)[0] }))
    };
  });
}

export function internet() {
  return cached('internet', async () => {
    const res = await probe('https://1.1.1.1/cdn-cgi/trace', { timeout: 4000 });
    return { up: res.ok === true, latencyMs: res.latency };
  });
}

const jfHeaders = src => ({ 'X-Emby-Token': src.key });

export function jellyfinSessions(config) {
  const src = config.sources.jellyfin;
  if (!src?.key) return null;
  return cached('jellyfin:sessions', async () => {
    const sessions = await get(`${trim(src.url)}/Sessions?activeWithinSeconds=120`, { headers: jfHeaders(src) });
    const playing = sessions.filter(s => s.NowPlayingItem);
    return {
      streams: playing.length,
      transcoding: playing.filter(s => s.TranscodingInfo && !s.TranscodingInfo.IsVideoDirect).length,
      items: playing.map(s => ({ title: s.NowPlayingItem.SeriesName ? `${s.NowPlayingItem.SeriesName} · ${s.NowPlayingItem.Name}` : s.NowPlayingItem.Name, device: s.DeviceName }))
    };
  });
}

export function jellyfinAddedThisWeek(config) {
  const src = config.sources.jellyfin;
  if (!src?.key) return null;
  return cached('jellyfin:added', async () => {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const count = async type => (await get(
      `${trim(src.url)}/Items?Recursive=true&IncludeItemTypes=${type}&MinDateCreated=${since}&Limit=0`,
      { headers: jfHeaders(src) }
    )).TotalRecordCount;
    const [episodes, films] = await Promise.all([count('Episode'), count('Movie')]);
    return { episodes, films };
  }, 10 * 60 * 1000);
}

export function jellyfinResume(config) {
  const src = config.sources.jellyfin;
  if (!src?.key || !src.user) return null;
  return cached('jellyfin:resume', async () => {
    const res = await get(`${trim(src.url)}/Users/${src.user}/Items/Resume?Limit=8&MediaTypes=Video&Fields=UserData`, { headers: jfHeaders(src) });
    return (res.Items || []).map(i => {
      const ticksLeft = (i.RunTimeTicks || 0) - (i.UserData?.PlaybackPositionTicks || 0);
      return {
        id: i.Id,
        title: i.SeriesName || i.Name,
        detail: i.SeriesName ? `S${i.ParentIndexNumber} E${i.IndexNumber}` : 'Film',
        minutesLeft: Math.round(ticksLeft / 600000000),
        progress: Math.round(i.UserData?.PlayedPercentage || 0)
      };
    });
  });
}

// Poster images: proxied so the API key never reaches the browser
export async function jellyfinImage(config, id) {
  const src = config.sources.jellyfin;
  if (!src?.key || !/^[0-9a-f]{32}$/i.test(id)) return null;
  return get(`${trim(src.url)}/Items/${id}/Images/Primary?maxHeight=360&quality=80`, { headers: jfHeaders(src), as: 'buffer' });
}

const SEERR_STATUS = { 1: 'Waiting for approval', 2: 'Approved', 3: 'Declined' };
const MEDIA_STATUS = { 2: 'Waiting for release', 3: 'Downloading', 4: 'Partly ready', 5: 'Ready to watch' };

export function seerrRequests(config) {
  const src = config.sources.seerr;
  if (!src?.key) return null;
  return cached('seerr', async () => {
    const headers = { 'X-Api-Key': src.key };
    const base = trim(src.url);
    const [count, list] = await Promise.all([
      get(`${base}/api/v1/request/count`, { headers }),
      get(`${base}/api/v1/request?take=6&sort=added`, { headers })
    ]);
    const items = await Promise.all((list.results || []).map(async r => {
      const kind = r.type === 'tv' ? 'tv' : 'movie';
      const media = await cached(`seerr:${kind}:${r.media.tmdbId}`, () => get(`${base}/api/v1/${kind}/${r.media.tmdbId}`, { headers }), 24 * 3600 * 1000);
      const title = media.title || media.name || 'Unknown title';
      const seasons = r.seasons?.length ? `, season ${r.seasons.map(s => s.seasonNumber).join(', ')}` : '';
      return {
        title: `${title}${seasons}`,
        status: r.status === 2 ? (MEDIA_STATUS[r.media.status] || 'Approved') : SEERR_STATUS[r.status] || 'Requested',
        ready: r.media.status === 5,
        requestedBy: r.requestedBy?.displayName || null,
        added: r.createdAt
      };
    }));
    return { pending: count.pending || 0, items };
  });
}

export function arrDetails(config, type) {
  const src = config.sources[type];
  if (!src?.key) return null;
  return cached(`${type}:details`, async () => {
    const headers = { 'X-Api-Key': src.key };
    const base = trim(src.url);
    const start = new Date().toISOString();
    const end = new Date(Date.now() + 7 * 86400000).toISOString();
    const [queue, calendar] = await Promise.all([
      get(`${base}/api/v3/queue?pageSize=10${type === 'sonarr' ? '&includeSeries=true&includeEpisode=true' : '&includeMovie=true'}`, { headers }),
      get(`${base}/api/v3/calendar?start=${start}&end=${end}${type === 'sonarr' ? '&includeSeries=true' : ''}`, { headers })
    ]);
    const label = item => type === 'sonarr'
      ? `${item.series?.title || 'Unknown'} · S${item.episode?.seasonNumber ?? item.seasonNumber} E${item.episode?.episodeNumber ?? item.episodeNumber}`
      : item.movie?.title || item.title;
    return [
      {
        title: 'Queue',
        rows: (queue.records || []).slice(0, 8).map(q => ({
          label: label(q),
          value: q.status === 'downloading' && q.size ? `downloading ${Math.round((1 - q.sizeleft / q.size) * 100)}%` : q.trackedDownloadState || q.status
        })),
        empty: 'Nothing in the queue'
      },
      {
        title: type === 'sonarr' ? 'Airing soon' : 'Coming soon',
        rows: calendar.slice(0, 8).map(c => ({
          label: type === 'sonarr' ? `${c.series?.title} · S${c.seasonNumber} E${c.episodeNumber}` : c.title,
          value: new Date(c.airDateUtc || c.digitalRelease || c.physicalRelease || c.inCinemas).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
        })),
        empty: 'Nothing in the next 7 days'
      }
    ];
  });
}

export function tandoorToday(config) {
  const src = config.sources.tandoor;
  if (!src?.token) return null;
  return cached('tandoor', async () => {
    const today = new Date().toLocaleDateString('en-CA');
    const res = await get(`${trim(src.url)}/api/meal-plan/?from_date=${today}&to_date=${today}`, { headers: { Authorization: `Bearer ${src.token}` } });
    const plans = Array.isArray(res) ? res : res.results || [];
    const dinner = plans.find(p => /dinner/i.test(p.meal_type?.name || p.meal_type_name || '')) || plans[plans.length - 1];
    if (!dinner) return { dinner: null };
    const recipe = dinner.recipe || {};
    return {
      dinner: {
        title: recipe.name || dinner.title,
        minutes: (recipe.working_time || 0) + (recipe.waiting_time || 0) || null,
        servings: dinner.servings || recipe.servings || null
      }
    };
  }, 5 * 60 * 1000);
}

// qBittorrent has no read-only API key, so it needs its login POST
export function qbittorrent(config) {
  const src = config.sources.qbittorrent;
  if (!src?.url) return null;
  return cached('qbittorrent', async () => {
    const base = trim(src.url);
    const headers = { Referer: base };
    if (src.user) {
      const res = await login(`${base}/api/v2/auth/login`, {
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username: src.user, password: src.password }),
        as: 'response'
      });
      const cookie = res.headers.get('set-cookie')?.split(';')[0];
      if (cookie) headers.Cookie = cookie;
    }
    const torrents = await get(`${base}/api/v2/torrents/info?filter=active`, { headers });
    return { active: torrents.length };
  });
}
