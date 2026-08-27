import { useEffect, useRef, useState } from "react";
import Portal from "./Portal";

// Overlay de popup com ABERTURA e FECHAMENTO animados. Mantém o conteúdo montado
// durante a saída (fadeOut no fundo + popOut no painel via CSS `.ovx`), só desmontando
// quando a animação termina. Um filho direto = o painel (recebe pop in/out).
//
// Dois modos:
//  1) boolean:  <AnimatedOverlay open={x} onClose={close}><div className="painel">…</div></AnimatedOverlay>
//  2) por dado: <AnimatedOverlay data={item} onClose={() => setItem(null)}>{(it) => <div className="painel">…{it.x}…</div>}</AnimatedOverlay>
//     — o overlay guarda o ÚLTIMO dado não-nulo, então a animação de SAÍDA ainda mostra
//       o conteúdo real (sem crash quando o estado vira null).
// Clique no backdrop chama onClose (fecha animado); clique no painel não fecha.
const EXIT_MS = 190; // casa com popOut/fadeOut (.18s) + folga

type Props<T> = {
  onClose: () => void;
  z?: number;
  className?: string;
  closeOnBackdrop?: boolean;
} & (
  | { open: boolean; data?: undefined; children: React.ReactNode }
  | { data: T | null | undefined; open?: undefined; children: (data: T) => React.ReactNode }
);

export default function AnimatedOverlay<T>({
  onClose,
  z = 60,
  className = "",
  closeOnBackdrop = true,
  ...rest
}: Props<T>) {
  const isData = "data" in rest && rest.data !== undefined ? true : rest.open === undefined && "data" in rest;
  const openNow = "open" in rest && rest.open !== undefined ? !!rest.open : (rest as { data?: T | null }).data != null;

  const [mounted, setMounted] = useState(openNow);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // guarda o último dado não-nulo NO RENDER (não em effect): quando aberto reflete o dado
  // VIVO (sem lag de digitação nos inputs); quando fecha, congela o último pra saída mostrar.
  const shownRef = useRef<T | null>("data" in rest ? (rest.data as T | null) : null);
  if ("data" in rest && rest.data != null) shownRef.current = rest.data as T;
  const shown = shownRef.current;

  useEffect(() => {
    if (openNow) {
      if (timer.current) clearTimeout(timer.current);
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      timer.current = setTimeout(() => { setMounted(false); setClosing(false); }, EXIT_MS);
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNow]);

  useEffect(() => {
    if (!openNow) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNow, onClose]);

  if (!mounted) return null;

  const kids = isData
    ? (shown != null ? (rest.children as (d: T) => React.ReactNode)(shown) : null)
    : (rest.children as React.ReactNode);
  if (kids == null) return null;

  return (
    <Portal>
      <div
        data-closing={closing ? "true" : "false"}
        onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose(); }}
        className={`ovx fixed inset-0 flex items-center justify-center bg-black/70 p-4 ${className}`}
        style={{ zIndex: z }}
        role="presentation"
      >
        {kids}
      </div>
    </Portal>
  );
}
