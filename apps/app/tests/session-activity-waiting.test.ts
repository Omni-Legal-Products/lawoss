import { beforeEach, describe, expect, test } from "bun:test";

import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";

const WORKSPACE = "workspace-1";
const SESSION = "session-1";

const store = () => useSessionActivityStore.getState();

beforeEach(() => {
  useSessionActivityStore.setState({ recordsByWorkspaceId: {}, statusesByWorkspaceId: {} });
});

describe("pending requests outlive the run that raised them", () => {
  test("a permission survives the engine reporting the session idle", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", true);
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("waiting");

    // The run blocks on the user, so the engine reports it idle while the
    // approval modal is still open. The sidebar must keep flagging the session.
    store().setRunStatus(WORKSPACE, SESSION, { type: "idle" });
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("waiting");
  });

  test("a question survives the same transition", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "question", "request-1", true);
    store().setRunStatus(WORKSPACE, SESSION, { type: "idle" });
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("waiting");
  });

  test("replying clears it even though the run already went idle", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", true);
    store().setRunStatus(WORKSPACE, SESSION, { type: "idle" });

    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", false);
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("idle");
  });

  test("reconnect reconciliation still drops requests the server no longer lists", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", true);
    store().setRunStatus(WORKSPACE, SESSION, { type: "idle" });

    store().replaceWaitingRequests(WORKSPACE, SESSION, "permission", []);
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("idle");
  });

  test("a run that resumes reports progress again, not waiting", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", true);
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", false);
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("thinking");
  });

  test("a failed session reports the error ahead of a stale request", () => {
    store().setRunStatus(WORKSPACE, SESSION, { type: "busy" });
    store().setWaitingRequest(WORKSPACE, SESSION, "permission", "request-1", true);
    store().setError(WORKSPACE, SESSION, "boom");
    expect(store().getStatus(WORKSPACE, SESSION)).toBe("error");
  });
});
