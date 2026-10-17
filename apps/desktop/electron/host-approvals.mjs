/** Present manual HTTP approvals only in the host's native main window. */
export function createHostApprovalHandler({ getWindow, showMessageBox, showContextReview = undefined }) {
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
        const source = request.actor.type === "host"
          ? "Host"
          : `Connected client (app, agent or remote connection)${request.actor.clientId ? `: ${request.actor.clientId}` : ""}`;
        const options = {
          type: "question",
          title: request.action === "ai.public.synthetic" ? "Public AI request" : "LegalWork approval",
          message: request.action === "ai.public.synthetic" ? "Send this public synthetic model request?" : "Allow this workspace change?",
          detail: [
            `Source: ${source}`,
            ...(request.actor.scope ? [`Access: ${request.actor.scope}`] : []),
            `Workspace: ${request.workspaceId}`,
            `Action: ${request.action}`,
            request.summary,
            ...(request.description ? [request.description] : []),
            ...(request.paths.length ? ["Paths:", ...request.paths] : []),
          ].join("\n"),
          buttons: ["Deny", "Allow"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
          signal: controller.signal,
        };
        const review = request.action === "ai.public.synthetic" || options.detail.length > 2000;
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
