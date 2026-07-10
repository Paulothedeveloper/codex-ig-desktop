// Ícones SVG compartilhados — zero emoji em UI (regra do Manual).
const ICON: Record<string, string> = {
  instagram:
    '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/>',
  report: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  clicks:
    '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  config:
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  badge:
    '<path d="M12 2l2.4 1.9 3-.4.6 3 2.4 1.9-1.4 2.7 1.4 2.7-2.4 1.9-.6 3-3-.4L12 22l-2.4-1.9-3 .4-.6-3-2.4-1.9 1.4-2.7-1.4-2.7 2.4-1.9.6-3 3 .4z"/><path d="M9 12l2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  star: '<path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  warn: '<path d="M12 3l9 16H3zM12 10v4M12 17.5v.5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/>',
};

export function Ic({ n, s = 18, fill = false }: { n: string; s?: number; fill?: boolean }) {
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "-3px", flex: "0 0 auto" }}
      dangerouslySetInnerHTML={{ __html: ICON[n] || "" }}
    />
  );
}
