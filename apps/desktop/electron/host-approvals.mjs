import { nativeCopy } from "./native-locale.mjs";
/** Present manual HTTP approvals only in the host's native main window. */
export function createHostApprovalHandler({ getWindow, showMessageBox, showContextReview = undefined, getLocale = (_window) => "en" }) {
  const contextActions = new Set(["ai.public.synthetic", "ai.documents.synthetic", "ai.protected.synthetic", "ai.documents.protected", "ai.protected.document"]);
  let queue = Promise.resolve();
  return (request, signal) => {
    const present = async () => {
      const window = getWindow?.();
      if (signal.aborted || !window || window.isDestroyed()) return "deny";

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      window.once("closed", abort);
      try {
        const copy = nativeCopy(getLocale(window));
        const source = request.actor.type === "host"
          ? copy.host
          : `${copy.connected}${request.actor.clientId ? `: ${request.actor.clientId}` : ""}`;
        // 🟡 LAWOSS #552: verejnú požiadavku AI formuluje hostiteľ v jazyku rozhrania; pracovný priestor nemá.
        const publicAi = request.action === "ai.public.synthetic" ? request.publicAi : undefined;
        const options = {
          type: "question",
          presentationKind: request.action === "ai.public.synthetic" ? "public" : "change",
          title: request.action === "ai.public.synthetic" ? copy.publicTitle : copy.approvalTitle,
          message: request.action === "ai.public.synthetic" ? copy.publicQuestion : copy.changeQuestion,
          detail: [
            `${copy.source}: ${source}`,
            ...(request.actor.scope ? [`${copy.access}: ${request.actor.scope}`] : []),
            ...(publicAi ? [] : [`${copy.workspace}: ${request.workspaceId}`]),
            `${copy.action}: ${request.action}`,
            ...(publicAi ? publicAiLines(copy, publicAi) : [request.summary]),
            ...(request.description ? [request.description] : []),
            ...(request.paths.length ? [`${copy.paths}:`, ...request.paths] : []),
          ].join("\n"),
          buttons: [copy.deny, copy.allow],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: controller.signal,
        };
        const review = contextActions.has(request.action) || options.detail.length > 2000;
        if (review && !showContextReview) return "deny";
        const result = await (review ? showContextReview : showMessageBox)(window, options);
        return !controller.signal.aborted && !window.isDestroyed() && result.response === 1 ? "allow" : "deny";
      } catch {
        return "deny";
      } finally {
        signal.removeEventListener("abort", abort);
        window.removeListener("closed", abort);
      }
    };
    const result = queue.then(present);
    queue = result.then(() => {}, () => {});
    return result;
  };
}

/** 🟡 LAWOSS #552: za týmito riadkami nasleduje `description` bez zmeny (úplný serializovaný kontext). */
function publicAiLines(copy, { origin, endpoint, providerId, modelId }) {
  const summary = copy.publicSummary.replace("{origin}", origin).replace("{provider}", providerId).replace("{model}", modelId);
  return [summary, `${copy.publicTarget}: ${endpoint}`, `${copy.publicContext}:`];
}
