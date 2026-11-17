import { useState } from 'react';

// Shared by the admin overview and the kiosk. Each page styles the sun-* classes.

// '13:00' → '1pm', '09:30' → '9:30am'
export function hm12(hm) {
  if (!hm) return '';
  const h = Number(hm.slice(0, 2));
  const m = hm.slice(3, 5);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`}${h >= 12 ? 'pm' : 'am'}`;
}

const span = w => (w ? `${hm12(w.start)}–${hm12(w.end)}` : null);

function tomorrowLine(t) {
  if (!t) return '';
  return t.window ? `Tomorrow: strong sun ${span(t.window)}.` : 'Tomorrow looks dull.';
}

// One plain-language line for "should I run the big stuff now?"
export function sunVerdict(s) {
  const w = s.today.window;
  const inFeedIn = s.feedInPeak && s.now >= s.feedInPeak[0] && s.now < s.feedInPeak[1];
  switch (s.state) {
    case 'now':
      return { level: 'good', title: 'Good sun now', detail: `Strong until ${hm12(w.end)}. A good time for the aircon and big loads.` };
    case 'later':
      return { level: 'soon', title: `Strong sun from ${hm12(w.start)}`, detail: `Until ${hm12(w.end)}. Hold big loads until then if you can.` };
    case 'past':
      return { level: 'done', title: 'Strong sun is over for today', detail: inFeedIn ? `Feed-in pays more until ${hm12(s.feedInPeak[1])}, so keep big loads light.` : tomorrowLine(s.tomorrow) };
    case 'low':
      return { level: 'done', title: 'Not much sun today', detail: `About ${s.today.cloud}% cloud. ${tomorrowLine(s.tomorrow)}` };
    case 'before':
      return { level: 'done', title: 'Sun’s not up yet', detail: w ? `Strong sun today ${span(w)}.` : 'Today looks dull.' };
    default:
      return { level: 'done', title: 'Sun’s down', detail: inFeedIn ? `Feed-in pays more until ${hm12(s.feedInPeak[1])}. ${tomorrowLine(s.tomorrow)}` : tomorrowLine(s.tomorrow) };
  }
}

// Hourly sunlight bars, sunrise to sunset. Strong hours are filled, the
// current hour is marked, and the higher feed-in period is shaded.
export function SunChart({ s, hover = true }) {
  const [tip, setTip] = useState(null);
  const hours = s.today.hours;
  if (!hours.length) return null;
  const first = hours[0].hour;
  const n = hours.length;
  const top = Math.max(1000, ...hours.map(h => h.w));
  const nowHour = Number(s.now.slice(0, 2));
  const pos = hour => `${(Math.min(Math.max(hour - first, 0), n) / n) * 100}%`;
  const fi = s.feedInPeak && Number(s.feedInPeak[0].slice(0, 2)) < first + n
    ? { left: pos(Number(s.feedInPeak[0].slice(0, 2))), right: `calc(100% - ${pos(Number(s.feedInPeak[1].slice(0, 2)))})` }
    : null;
  const labels = hours.filter(h => h.hour % 3 === 0);

  return (
    <figure className="sun-chart" onPointerLeave={() => setTip(null)}>
      <div className="sun-plot" role="img" aria-label={`Sunlight by hour today. ${s.today.window ? `Strong ${span(s.today.window)}.` : 'No strong hours.'}`}>
        {fi && <div className="sun-feedin" style={fi}><span>higher feed-in</span></div>}
        <div className="sun-good" style={{ bottom: `${(s.goodWatts / top) * 100}%` }}><span>strong</span></div>
        {hours.map((h, i) => (
          <div
            key={h.hour}
            className={`sun-col${h.w >= s.goodWatts ? ' strong' : ''}${h.hour === nowHour ? ' now' : ''}`}
            onPointerEnter={hover ? () => setTip(i) : undefined}
            onPointerDown={hover ? () => setTip(i) : undefined}
          >
            <i style={{ height: `${Math.max(2, (h.w / top) * 100)}%` }} />
          </div>
        ))}
        {hover && tip != null && (
          <div className="sun-tip" style={{ left: `${Math.min(Math.max(((tip + 0.5) / n) * 100, 15), 85)}%` }}>
            <b>{hm12(`${String(hours[tip].hour).padStart(2, '0')}:00`)}–{hm12(`${String(hours[tip].hour + 1).padStart(2, '0')}:00`)}</b>
            {' · '}{hours[tip].w} W/m² · {hours[tip].cloud}% cloud
          </div>
        )}
      </div>
      <div className="sun-axis">
        {labels.map(h => <span key={h.hour} style={{ left: pos(h.hour) }}>{hm12(`${String(h.hour).padStart(2, '0')}:00`)}</span>)}
      </div>
    </figure>
  );
}
