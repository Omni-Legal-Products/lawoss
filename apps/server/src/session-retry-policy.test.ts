import { expect, test } from "bun:test";
import { retryStopReason } from "./session-retry-policy.js";

test("transient errors get two retries, persistent failures stop with recovery instructions", () => {
  expect(retryStopReason({ type: "retry", attempt: 1, message: "503 Service unavailable" })).toBeNull();
  expect(retryStopReason({ type: "retry", attempt: 2, message: "Connection reset" })).toBeNull();
  expect(retryStopReason({ type: "retry", attempt: 3, message: "503 Service unavailable" })).toContain("choose another model");
  expect(retryStopReason({ type: "idle", attempt: 4 })).toBeNull();
});

test("terminal authentication, quota and unavailable usage pricing stop on their first retry", () => {
  for (const message of ["Invalid API key", "Budget exceeded", "Usage pricing is unavailable, HTTP 503"]) {
    expect(retryStopReason({ type: "retry", attempt: 1, message })).toContain(message);
  }
});
