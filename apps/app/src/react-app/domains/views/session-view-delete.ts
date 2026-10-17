import { ViewPreviewSchema, type SessionViewReview } from "@legalwork/types/views";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

/** DELETE is also the atomic review check; older servers do not expose the review route. */
export async function deleteOrReviewSession(remove: () => Promise<void>): Promise<SessionViewReview | null> {
  try { await remove(); return null; }
  catch (error) {
    if (!(error instanceof LegalworkServerError) || error.status !== 409 || error.code !== "unsaved_session_views") throw error;
    const value = error.details;
    if (!value || typeof value !== "object" || !("reviewToken" in value) || typeof value.reviewToken !== "string" || !value.reviewToken
      || !("items" in value) || !Array.isArray(value.items) || !value.items.length) throw error;
    const items: SessionViewReview["items"] = [];
    const candidates: unknown[] = value.items;
    for (const item of candidates) {
      if (!item || typeof item !== "object" || !("callId" in item) || typeof item.callId !== "string" || !("title" in item) || typeof item.title !== "string"
        || "sessionId" in item && item.sessionId !== undefined && typeof item.sessionId !== "string") throw error;
      const preview = !("preview" in item) || item.preview === undefined ? undefined : ViewPreviewSchema.safeParse(item.preview);
      if (preview && !preview.success) throw error;
      items.push({ callId: item.callId, title: item.title, sessionId: "sessionId" in item && typeof item.sessionId === "string" ? item.sessionId : undefined, preview: preview?.data });
    }
    return { items, reviewToken: value.reviewToken };
  }
}

export function sessionDeleteError(error: unknown): string {
  return error instanceof LegalworkServerError && error.code === "session_busy"
    ? t("session.delete_busy") : error instanceof Error ? error.message : t("session.delete_failed");
}
