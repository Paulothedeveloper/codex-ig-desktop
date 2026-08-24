// Botão "?" contextual — explica brevemente a ferramenta/botão ao lado.
// Popover portaled + posicionado por getBoundingClientRect + clamp na viewport
// (não corta, não estoura). Fecha por clique fora / Esc.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function Help({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    const W = 260, margin = 8;
    let left = b.left + b.width / 2 - W / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - W - margin));
    let top = b.bottom + 8;
    // se não cabe embaixo, joga pra cima
    const popH = popRef.current?.offsetHeight || 120;
    if (top + popH > window.innerHeight - margin) top = Math.max(margin, b.top - popH - 8);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={label || "Ajuda"}
        title={label || "Ajuda"}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[var(--color-steel)] text-[10px] font-bold leading-none text-[var(--color-slate)] hover:border-[var(--color-teal)] hover:text-[var(--color-teal2)] align-middle"
      >
        ?
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 260, zIndex: 90 }}
          className="pop rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-3 text-[12px] leading-relaxed text-[var(--color-ink)] shadow-[0_18px_44px_-18px_rgba(0,0,0,.9)]"
          onClick={(e) => e.stopPropagation()}
        >
          {label && <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--color-teal2)]">{label}</div>}
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}
