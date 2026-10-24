/**
 * #242 (k N-A4-7): skupiny chatov a chaty v bočnom paneli sú `Reorder.Item`, ktoré motion meria pri každom vykreslení.
 * S animáciou polohy vždy sa po rozbalení chatu s podchatmi alebo skupiny ďalší riadok chvíľu posúval zo starého miesta
 * cez nové riadky. Animácia polohy beží len počas ťahania (ako pri projektoch v `app-sidebar.tsx`), inak je posun hneď.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

let dragging = 0;
const listeners = new Set<() => void>();
const change = (delta: number) => {
  dragging = Math.max(0, dragging + delta);
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

const isDragging = (): boolean => dragging > 0;
const INSTANT = { layout: { type: false } } as const;

/** Prechod a obsluha ťahania pre `Reorder.Item` chatu alebo skupiny; počas ťahania predvolená animácia motion. */
export function useSidebarReorderSpring(): { transition: typeof INSTANT | undefined; onDragStart: () => void; onDragEnd: () => void } {
  const active = useSyncExternalStore(subscribe, isDragging, isDragging);
  const mine = useRef(false);
  const end = () => { if (mine.current) { mine.current = false; change(-1); } };
  // Položka odpojená počas ťahania nesmie nechať panel s animáciou.
  useEffect(() => end, []);
  return {
    transition: active ? undefined : INSTANT,
    onDragStart: () => { if (!mine.current) { mine.current = true; change(1); } },
    onDragEnd: end,
  };
}
