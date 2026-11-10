import { expect, test } from "bun:test";
import { mergeLegalworkServerSettingsFromEnv } from "../src/app/lib/legalwork-server";

test("a headless host token fills an empty browser and replaces a token from an older server", () => {
  const filled = mergeLegalworkServerSettingsFromEnv({}, { token: "client", hostToken: "host" });
  expect(filled.changed).toBe(true);
  expect(filled.next.hostToken).toBe("host");
  expect(filled.next.token).toBe("client");

  const replaced = mergeLegalworkServerSettingsFromEnv(
    { token: "old-client", hostToken: "old-host", urlOverride: "http://127.0.0.1:8787" },
    { token: "client", hostToken: "host", url: "http://127.0.0.1:9999" },
  );
  expect(replaced.changed).toBe(true);
  expect(replaced.next.hostToken).toBe("host");
  expect(replaced.next.token).toBe("client");
  expect(replaced.next.urlOverride).toBe("http://127.0.0.1:8787");
});

test("an empty env leaves a stored host token in place", () => {
  const kept = mergeLegalworkServerSettingsFromEnv({ hostToken: "kept", token: "kept-client" }, {});
  expect(kept.changed).toBe(false);
  expect(kept.next.hostToken).toBe("kept");
  expect(kept.next.token).toBe("kept-client");
});
