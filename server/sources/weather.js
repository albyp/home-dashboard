import { get } from '../lib/http.js';
import { cached } from '../lib/cache.js';

// Open-Meteo: free, no key. WMO weather codes mapped to a short word and an icon name.
const CODES = [
  [[0], 'Clear', 'sun'],
  [[1], 'Mostly sunny', 'sun'],
  [[2], 'Partly cloudy', 'partly'],
  [[3], 'Cloudy', 'cloud'],
  [[45, 48], 'Fog', 'cloud'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'rain'],
  [[95, 96, 99], 'Storms', 'storm']
];

export function describe(code) {
  const hit = CODES.find(([codes]) => codes.includes(code));
  return hit ? { text: hit[1], icon: hit[2] } : { text: 'Unknown', icon: 'cloud' };
}

export function weather(config) {
  const src = config.sources.weather;
  if (!src?.latitude || !src?.longitude) return null;
  return cached('weather', async () => {
    const q = new URLSearchParams({
      latitude: src.latitude,
      longitude: src.longitude,
      current: 'temperature_2m,weather_code',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,uv_index_max',
      timezone: 'auto',
      forecast_days: '4'
    });
    const res = await get(`https://api.open-meteo.com/v1/forecast?${q}`);
    const d = res.daily;
    return {
      now: { temp: Math.round(res.current.temperature_2m), ...describe(res.current.weather_code), uvMax: Math.round(d.uv_index_max[0]) },
      today: { max: Math.round(d.temperature_2m_max[0]), min: Math.round(d.temperature_2m_min[0]) },
      days: d.time.slice(1).map((t, i) => ({
        date: t,
        max: Math.round(d.temperature_2m_max[i + 1]),
        min: Math.round(d.temperature_2m_min[i + 1]),
        ...describe(d.weather_code[i + 1])
      }))
    };
  }, 15 * 60 * 1000);
}
