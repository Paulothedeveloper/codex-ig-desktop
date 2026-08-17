// Dropdown custom (regra do Manual: nunca <select> nativo — popup do SO não estiliza, "cara de barata").
// listbox + ARIA + click-outside + Esc + navegação por seta. Sem @keyframes que começa invisível.
import { useEffect, useRef, useState } from "react";

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // índice destacado (teclado)
  const ref = useRef<HTMLDivElement>(null);
  const cur = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(options.length - 1, h + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); onChange(options[hi].value); setOpen(false); }
  }

  return (
    <div ref={ref} className="relative mt-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onKeyDown={onKey}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-[#0a0f18] border border-[var(--color-steel)] rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--color-paper)] outline-none focus:border-[var(--color-teal)] disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span className="truncate">{cur?.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="text-[var(--color-slate)]"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-20 mt-1 w-full rounded-lg border border-[var(--color-steel)] bg-[#0c121c] py-1 shadow-[0_16px_40px_-16px_rgba(0,0,0,.9)]"
        >
          {options.map((o, i) => {
            const on = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setHi(i)}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={
                  "cursor-pointer px-3 py-1.5 text-[13px] " +
                  (on
                    ? "text-[#04120f] bg-[linear-gradient(135deg,#00e5c9,#0aa892)] font-bold"
                    : i === hi
                      ? "text-[var(--color-paper)] bg-white/5"
                      : "text-[var(--color-paper)]")
                }
              >
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
