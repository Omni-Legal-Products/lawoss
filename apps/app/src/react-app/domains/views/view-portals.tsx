import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { InlineView } from "./view-inline";

/** Portals retain the reader's authenticated host context inside sanitized HTML. */
export function useViewPortals(root: RefObject<HTMLDivElement | null>, html: string) {
  const [targets, setTargets] = useState<HTMLElement[]>([]);
  useEffect(() => { setTargets(Array.from(root.current?.querySelectorAll<HTMLElement>("[data-legalwork-view-block]") ?? [])); }, [root, html]);
  return targets.map((target, index) => createPortal(<InlineView source={target.dataset.legalworkViewBlock ?? ""} />, target, String(index)));
}
