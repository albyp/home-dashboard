const PATHS = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></>,
  house: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>,
  tv: <><rect x="3" y="5" width="18" height="12" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><path d="M10 9l5 2-5 2z" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
};

export function Icon({ name }) {
  return <svg className="k-icon" viewBox="0 0 24 24" aria-hidden="true">{PATHS[name]}</svg>;
}

export function WeatherIcon({ icon, className }) {
  const sun = (
    <g>
      <circle cx="24" cy="24" r="9" fill="var(--sun)" />
      <g stroke="var(--sun)" strokeWidth="3" strokeLinecap="round">
        <line x1="24" y1="4" x2="24" y2="9" /><line x1="24" y1="39" x2="24" y2="44" /><line x1="4" y1="24" x2="9" y2="24" /><line x1="39" y1="24" x2="44" y2="24" />
        <line x1="10" y1="10" x2="13.5" y2="13.5" /><line x1="34.5" y1="34.5" x2="38" y2="38" /><line x1="10" y1="38" x2="13.5" y2="34.5" /><line x1="34.5" y1="13.5" x2="38" y2="10" />
      </g>
    </g>
  );
  const cloud = <path d="M14 36h22a8 8 0 0 0 0-16 11 11 0 0 0-21-2 9 9 0 0 0-1 18z" fill="var(--cloud)" />;
  const drops = <g stroke="var(--rain)" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="40" x2="16" y2="45" /><line x1="26" y1="40" x2="24" y2="45" /><line x1="34" y1="40" x2="32" y2="45" /></g>;
  const bolt = <path d="M26 34l-6 8h5l-3 6 8-9h-5l3-5z" fill="var(--sun)" />;
  const body = {
    sun,
    partly: <><g transform="translate(-6 -6) scale(.8)">{sun}</g>{cloud}</>,
    cloud,
    rain: <><g transform="translate(0 -4)">{cloud}</g>{drops}</>,
    storm: <><g transform="translate(0 -4)">{cloud}</g>{bolt}</>
  }[icon] || cloud;
  return <svg className={className} viewBox="0 0 48 48" aria-hidden="true">{body}</svg>;
}

export function Bin({ colour }) {
  return (
    <svg className="k-bin" viewBox="0 0 52 64" aria-hidden="true">
      <rect x="6" y="14" width="40" height="46" rx="4" fill="var(--soft)" />
      <rect x="3" y="6" width="46" height="10" rx="3" fill={colour} />
      <rect x="20" y="2" width="12" height="6" rx="2" fill={colour} />
    </svg>
  );
}
