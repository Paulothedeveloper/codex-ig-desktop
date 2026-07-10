import { useState } from "react";
import Limpar from "./Limpar";
import Alvos from "./Alvos";

export default function Instagram() {
  const [mode, setMode] = useState<"limpar" | "alvos">("limpar");
  return (
    <div className="space-y-4">
      <div className="inline-flex gap-1 rounded-xl border border-[var(--color-line)] bg-[#0a0f18] p-1">
        {(["limpar", "alvos"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={
              "px-4 py-1.5 rounded-lg text-[13px] font-bold transition " +
              (mode === m
                ? "bg-[linear-gradient(135deg,#00e5c9,#0aa892)] text-[#04120f]"
                : "text-[var(--color-slate)] hover:text-[var(--color-paper)]")
            }
          >
            {m === "limpar" ? "Limpar" : "Alvos"}
          </button>
        ))}
      </div>
      {mode === "limpar" ? <Limpar /> : <Alvos />}
    </div>
  );
}
