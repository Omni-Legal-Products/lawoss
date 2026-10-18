import { expect, test } from "bun:test";
import { createLegalworkServerClient, LegalworkServerError } from "../src/app/lib/legalwork-server";
import { deleteOrReviewSession, sessionDeleteError } from "../src/react-app/domains/views/session-view-delete";

test("deletion works with an older server that only implements DELETE", async () => {
  const calls: string[] = [];
  const server = Bun.serve({ port: 0, fetch(request) {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return request.method === "DELETE" ? Response.json({ ok: true }) : Response.json({ code: "not_found" }, { status: 404 });
  } });
  try {
    const client = createLegalworkServerClient({ baseUrl: server.url.origin, token: "token" });
    expect(await deleteOrReviewSession(async () => { await client.deleteSession("project", "chat"); })).toBeNull();
    expect(calls).toEqual(["DELETE /workspace/project/sessions/chat"]);
  } finally { server.stop(true); }
});

test("only a valid unsaved-dashboard refusal opens review, retaining older incomplete previews", async () => {
  const review = { reviewToken: "opaque-token", items: [{ callId: "call", title: "Dashboard", sessionId: "child" }] };
  const result = await deleteOrReviewSession(async () => { throw new LegalworkServerError(409, "unsaved_session_views", "Review dashboards", review); });
  expect(result).toEqual({ ...review, items: [{ ...review.items[0], preview: undefined }] });
});

test("busy and network failures propagate to visible errors without suggesting dashboard loss", async () => {
  const error = new LegalworkServerError(409, "session_busy", "Stop agent chats so dashboards can be checked.");
  await expect(deleteOrReviewSession(async () => { throw error; })).rejects.toBe(error);
  expect(sessionDeleteError(error)).toContain("Stop this chat");
  expect(sessionDeleteError(error)).not.toContain("dashboard");
  const network = new Error("Connection lost");
  await expect(deleteOrReviewSession(async () => { throw network; })).rejects.toBe(network);
  expect(sessionDeleteError(network)).toBe("Connection lost");
});

test("malformed review details never authorize a discard or masquerade as a successful delete", async () => {
  for (const details of [undefined, { reviewToken: "", items: [] }, { reviewToken: "token", items: [{ callId: "call", title: "Dashboard", preview: {} }] }]) {
    const error = new LegalworkServerError(409, "unsaved_session_views", "Cannot delete", details);
    await expect(deleteOrReviewSession(async () => { throw error; })).rejects.toBe(error);
  }
});
