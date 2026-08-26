// Barra de título CUSTOM (decorations:false) — some com a cara de Windows.
// Drag pela regiao, botoes min/max/fechar via window API, e handles de redimensionar
// nas bordas/cantos (decorations:false tira o resize nativo, entao recriamos).
import { getCurrentWindow } from "@tauri-apps/api/window";

const w = () => getCurrentWindow();

function Btn({ onClick, label, danger, children }: { onClick: () => void; label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={"grid h-full w-11 place-items-center text-[var(--color-slate)] transition-colors " + (danger ? "hover:bg-[#e0245e] hover:text-white" : "hover:bg-white/10 hover:text-[var(--color-paper)]")}
    >
      {children}
    </button>
  );
}

const S = ({ d }: { d: string }) => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.1"><path d={d} /></svg>
);

// bordas invisiveis pra redimensionar (decorations:false)
function Resizers() {
  const grab = (dir: any) => (e: React.MouseEvent) => { if (e.button === 0) w().startResizeDragging(dir); };
  const edge = "fixed z-[100]"; // fixed = sempre nas bordas da JANELA (independe de ancestral posicionado)
  return (
    <>
      <div className={edge + " left-2 right-2 top-0 h-1 cursor-ns-resize"} onMouseDown={grab("North")} />
      <div className={edge + " left-2 right-2 bottom-0 h-1 cursor-ns-resize"} onMouseDown={grab("South")} />
      <div className={edge + " top-2 bottom-2 left-0 w-1 cursor-ew-resize"} onMouseDown={grab("West")} />
      <div className={edge + " top-2 bottom-2 right-0 w-1 cursor-ew-resize"} onMouseDown={grab("East")} />
      <div className={edge + " top-0 left-0 h-2 w-2 cursor-nwse-resize"} onMouseDown={grab("NorthWest")} />
      <div className={edge + " top-0 right-0 h-2 w-2 cursor-nesw-resize"} onMouseDown={grab("NorthEast")} />
      <div className={edge + " bottom-0 left-0 h-2 w-2 cursor-nesw-resize"} onMouseDown={grab("SouthWest")} />
      <div className={edge + " bottom-0 right-0 h-2 w-2 cursor-nwse-resize"} onMouseDown={grab("SouthEast")} />
    </>
  );
}

export default function Titlebar() {
  return (
    <>
      <Resizers />
      <div
        data-tauri-drag-region
        onDoubleClick={() => w().toggleMaximize()}
        className="relative z-[90] flex h-8 shrink-0 select-none items-center border-b border-[var(--color-line)] bg-[#0a0f18] pl-3"
      >
        <span data-tauri-drag-region className="pointer-events-none text-[11.5px] font-bold tracking-tight text-[var(--color-teal2)]">Codex IG</span>
        <div className="ml-auto flex h-full">
          <Btn onClick={() => w().minimize()} label="Minimizar"><S d="M2 5.5h7" /></Btn>
          <Btn onClick={() => w().toggleMaximize()} label="Maximizar"><S d="M2.5 2.5h6v6h-6z" /></Btn>
          <Btn onClick={() => w().close()} label="Fechar" danger><S d="M2.5 2.5l6 6M8.5 2.5l-6 6" /></Btn>
        </div>
      </div>
    </>
  );
}
