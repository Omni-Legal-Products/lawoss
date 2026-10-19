import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { createHostApprovalHandler } from "./host-approvals.mjs";

const request = {
  workspaceId: "workspace",
  action: "skills.delete",
  summary: "Delete skill demo",
  paths: ["/workspace/.opencode/skills/demo"],
  actor: { type: "remote", clientId: "client-1", scope: "collaborator" },
};

function hostWindow() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

test("shows the requester and affected paths with deny as default and cancel", async () => {
  const window = hostWindow();
  const handler = createHostApprovalHandler({
    getWindow: () => window,
    showMessageBox: async (parent, options) => {
      assert.equal(parent, window);
      assert.equal(options.defaultId, 0);
      assert.equal(options.cancelId, 0);
      assert.deepEqual(options.buttons, ["Deny", "Allow"]);
      assert.match(options.detail, /client-1/);
      assert.match(options.detail, /skills\.delete/);
      assert.match(options.detail, /\/workspace\/\.opencode\/skills\/demo/);
      return { response: 1 };
    },
  });
  assert.equal(await handler(request, new AbortController().signal), "allow");
  assert.equal(window.listenerCount("closed"), 0);
});

test("a missing or destroyed host window never opens a dialog", async () => {
  for (const window of [null, { isDestroyed: () => true }]) {
    const handler = createHostApprovalHandler({
      getWindow: () => window,
      showMessageBox: async () => assert.fail("dialog must not open"),
    });
    assert.equal(await handler(request, new AbortController().signal), "deny");
  }
});

test("closing the host window or cancelling the request aborts the dialog", async () => {
  for (const closeWindow of [true, false]) {
    const window = hostWindow();
    const controller = new AbortController();
    const handler = createHostApprovalHandler({
      getWindow: () => window,
      showMessageBox: async (_parent, options) => {
        if (closeWindow) window.emit("closed");
        else controller.abort();
        assert.equal(options.signal.aborted, true);
        return { response: 1 };
      },
    });
    assert.equal(await handler(request, controller.signal), "deny");
  }
});

test("a dismissed or failed dialog denies the request", async () => {
  for (const showMessageBox of [async () => ({ response: 0 }), async () => { throw new Error("unavailable"); }]) {
    const handler = createHostApprovalHandler({ getWindow: hostWindow, showMessageBox });
    assert.equal(await handler(request, new AbortController().signal), "deny");
  }
});

test("serializes dialogs and skips a cancelled request waiting in the queue", async () => {
  /** @type {(result: { response: number }) => void} */
  let finish = () => assert.fail("dialog must open first");
  let opened = 0;
  const handler = createHostApprovalHandler({
    getWindow: hostWindow,
    showMessageBox: () => {
      opened += 1;
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  const first = handler(request, new AbortController().signal);
  const controller = new AbortController();
  const second = handler(request, controller.signal);
  await Promise.resolve();
  assert.equal(opened, 1);
  controller.abort();
  finish({ response: 1 });
  assert.equal(await first, "allow");
  assert.equal(await second, "deny");
  assert.equal(opened, 1);
});

test("public model confirmation uses bounded exact-context review, never the native message box", async () => {
  const window = hostWindow();
  const description = 'Target: http://127.0.0.1/v1/chat/completions\n' + '<img src="https://invalid.test/">'.repeat(400) + "EXACT-END";
  const handler = createHostApprovalHandler({getWindow: () => window,
    showMessageBox: async () => assert.fail("Long exact context cannot use the unbounded native sheet"),
    showContextReview: async (parent, options) => {
      assert.equal(parent, window);
      assert.equal(options.title, "Public AI request");
      assert.equal(options.message, "Send this public synthetic model request?");
      assert.ok(options.detail.includes(description));
      assert.ok(options.detail.endsWith(request.paths[0]));
      assert.equal(options.defaultId, 0);
      return {response: 1};
    }});
  assert.equal(await handler({...request, action: "ai.public.synthetic", description}, new AbortController().signal), "allow");
});

test("public context fails closed without review surface; long ordinary approvals use it too", async () => {
  const handler = createHostApprovalHandler({getWindow: hostWindow, showMessageBox: async () => assert.fail("No context fallback")});
  assert.equal(await handler({...request, action: "ai.public.synthetic", description: "full context"}, new AbortController().signal), "deny");
  let shown = false;
  const bounded = createHostApprovalHandler({getWindow: hostWindow, showMessageBox: async () => assert.fail("No native overflow"), showContextReview: async () => {shown = true; return {response: 0};}});
  assert.equal(await bounded({...request, description: "x".repeat(9000)}, new AbortController().signal), "deny");
  assert.equal(shown, true);
});

for (const action of ["ai.documents.synthetic", "ai.protected.synthetic", "ai.documents.protected", "ai.protected.document"]) {
  test(`short ${action} requests always use isolated full-context review and fail closed without it`, async () => {
    let shown = 0;
    const handler = createHostApprovalHandler({getWindow: hostWindow,
      showMessageBox: async () => assert.fail("Protected context cannot use the ordinary message box"),
      showContextReview: async (_parent, options) => {shown++; assert.match(options.detail, new RegExp(action.replaceAll(".", "\\."))); assert.ok(options.detail.includes("SHORT-EXACT-CONTEXT")); return {response: 1};}});
    assert.equal(await handler({...request, action, description: "SHORT-EXACT-CONTEXT"}, new AbortController().signal), "allow");
    assert.equal(shown, 1);
    const unavailable = createHostApprovalHandler({getWindow: hostWindow, showMessageBox: async () => assert.fail("No fallback to unreviewed native sheet")});
    assert.equal(await unavailable({...request, action, description: "SHORT-EXACT-CONTEXT"}, new AbortController().signal), "deny");
  });
}
