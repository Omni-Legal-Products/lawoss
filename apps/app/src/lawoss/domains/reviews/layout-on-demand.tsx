/**
 * LAWOSS: tlačidlo „Spracovať aj rozloženie strany“ pri rozpoznaných stranách v kontrole.
 *
 * Rozhodnutie MČ 8. 11. 2026 (limit RAM 2 GB, issue #367): automatická príprava číta skeny
 * len rozpoznávaním textu; model rozloženia (PP-DocLayoutV3, špička asi 1 GB) sa spustí iba na
 * výslovnú žiadosť advokáta pre jeden dokument. Tlačidlo spustí kontrolu tohto dokumentu
 * s `layout: true`: server doplní rozloženie k už rozpoznanému textu a odpovede k dokumentu
 * pripraví znova. Server: `apps/server/src/lawoss/layout-on-demand.ts`.
 */
import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutPanelTop } from "lucide-react";
import { reviewRunningElsewhere } from "@legalwork/types/reviews";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { reviewKey } from "@/react-app/domains/reviews/review-ui";

export function LayoutOnDemandAction({ client, workspaceId, reviewId, documentId, onPrepared }: {
  client: Pick<LegalworkServerClient, "getReview" | "startReview">;
  workspaceId: string; reviewId: string; documentId: string;
  /** Called once the requested run has finished, to show the new layout. */
  onPrepared: () => void;
}) {
  const queryClient = useQueryClient();
  const requested = useRef(false);
  const review = useQuery({ queryKey: reviewKey(workspaceId, reviewId), queryFn: () => client.getReview(workspaceId, reviewId),
    refetchInterval: query => query.state.data?.status === "running" ? 2000 : false });
  const start = useMutation({
    mutationFn: async () => {
      const current = review.data ?? await client.getReview(workspaceId, reviewId);
      return client.startReview(workspaceId, reviewId, { revision: current.revision, rerun: false, reprocess: false, documentIds: [documentId], layout: true });
    },
    onSuccess: async value => {
      requested.current = true;
      queryClient.setQueryData(reviewKey(workspaceId, reviewId), value);
      await queryClient.invalidateQueries({ queryKey: reviewKey(workspaceId) });
    },
  });
  const running = review.data?.status === "running";
  useEffect(() => {
    if (requested.current && review.data && !running) { requested.current = false; onPrepared(); }
  }, [running, review.data, onPrepared]);
  const busy = start.isPending || (requested.current && running);
  const blocked = !review.data || running || reviewRunningElsewhere(review.data);
  return <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2">
    <Button variant="outline" size="sm" disabled={busy || blocked} onClick={() => start.mutate()}>
      <LayoutPanelTop className="size-3.5" />{busy ? t("lawoss.ocr.layout_running") : t("lawoss.ocr.layout_action")}
    </Button>
    <p className="min-w-0 flex-1 text-xs text-muted-foreground">
      {!busy && running ? t("lawoss.ocr.layout_wait") : t("lawoss.ocr.layout_hint")}
    </p>
    {start.isError && <p role="alert" className="w-full text-xs text-warning">{t("lawoss.ocr.layout_failed")}</p>}
  </div>;
}
