import { useCallback, useLayoutEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Keep async navigation above refreshable panels, but discard it after the user leaves this visit. */
export function usePageNavigation(): (to: string) => void {
  const { key } = useLocation();
  const navigate = useNavigate();
  // Back restores a history key, but must never revive an earlier visit's request.
  const visit = useMemo(() => ({ active: false }), [key]);
  useLayoutEffect(() => {
    visit.active = true;
    return () => { visit.active = false; };
  }, [visit]);
  return useCallback((to: string) => {
    if (visit.active) navigate(to);
  }, [visit, navigate]);
}
