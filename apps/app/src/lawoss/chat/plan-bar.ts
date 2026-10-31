/**
 * N-A8-6 (regresia 30. 10. 2026): pruh „Priebeh · 1/3“ nad composerom je v LAWOSS znakom, že agent práve pracuje.
 * Upstream ho ukazuje, kým má plán agenta nedokončený krok, aj keď beh dávno skončil (napr. po reštarte alebo keď
 * agent prestal pred koncom plánu). Advokát si potom myslí, že úloha ešte beží. Pruh sa preto ukáže len počas behu
 * (odosielanie, beh, opakovanie, čakanie na povolenie či odpoveď). Plán ostáva v pamäti chatu a pri ďalšom behu sa
 * vráti; jeho kroky ostávajú aj v rozhovore.
 */
import type { TodoItem } from "@/app/types";
import { hasUnfinishedTodos } from "@/react-app/domains/session/surface/todo-panel";

export function planBarVisible(todos: readonly TodoItem[], running: boolean): boolean {
  return running && hasUnfinishedTodos([...todos]);
}
