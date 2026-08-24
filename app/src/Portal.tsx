// Portal pra document.body — escapa ancestral com transform/filter (senão position:fixed
// ancora no ancestral, não na viewport → modal mal posicionado). Regra do Manual.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

export default function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
