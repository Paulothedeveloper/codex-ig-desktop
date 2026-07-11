// Marca orbit — arco teal de momentum + ponto coral de crescimento no pico.
export function Logo({ s = 34 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 1024 1024" style={{ flex: "0 0 auto" }}>
      <defs>
        <linearGradient id="lg-t" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0aa892" />
          <stop offset="1" stopColor="#00e5c9" />
        </linearGradient>
        <radialGradient id="lg-g" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ff4d3d" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ff4d3d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="12" y="12" width="1000" height="1000" rx="224" fill="#0d1420" />
      <path d="M 296 726 A 348 306 -12 0 1 694 366" fill="none" stroke="url(#lg-t)" strokeWidth="84" strokeLinecap="round" />
      <circle cx="704" cy="344" r="158" fill="url(#lg-g)" />
      <circle cx="704" cy="344" r="76" fill="#ff4d3d" />
    </svg>
  );
}
