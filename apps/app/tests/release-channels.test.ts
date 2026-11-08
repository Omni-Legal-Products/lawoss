import { expect, test } from "bun:test";
import { coerceReleaseChannel } from "../src/app/lib/release-channels";
import { orgPolicyDefinitions } from "@legalwork/types/org-policy";

test("channel preferences retain existing choices and persist the new pre-release choice", () => {
  for (const channel of ["stable", "prerelease", "alpha"]) expect(coerceReleaseChannel(channel)).toBe(channel);
  for (const value of [null, undefined, "", "beta", "unknown"]) expect(coerceReleaseChannel(value)).toBe("stable");
});

test("organisation policy accepts all three update channels", () => {
  for (const channel of ["stable", "prerelease", "alpha"]) expect(orgPolicyDefinitions["updates.channel"].schema.safeParse(channel).success).toBe(true);
});
