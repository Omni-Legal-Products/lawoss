/**
 * LAWOSS (#452): štartovací prekryv zmizne až po `markRouteReady` (boot-state.tsx). Trasa, ktorá nečaká na
 * zoznam priečinkov ako pracovný priestor či Nastavenia, ho nastaví hneď po prvom vykreslení. Inak reload
 * priamo na takej trase (napr. `/welcome`) nechá prekryv navždy.
 */
import { useEffect } from "react";
import { useBootState } from "@/react-app/shell/boot-state";

export function useRouteReadyOnMount(): void {
  const { markRouteReady } = useBootState();
  useEffect(() => markRouteReady(), [markRouteReady]);
}
