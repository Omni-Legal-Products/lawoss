import { describe, expect, test } from "bun:test";
import type { ExistingPlanRequest, OnboardingPlanRequest } from "../src/lawoss/domains/onboarding/api";

describe("LAWOSS onboarding request contract", () => {
  test("keeps map inputs explicit so a read-only mapping cannot be planned from an empty memory claim", () => {
    const request: ExistingPlanRequest = {
      action: "existing", root: "/Office/Clients/Acme", mode: "map", title: "Acme", clientType: "po", jurisdiction: "sk", date: "2026-10-03", language: "sk", memoryPath: "memory/MEMORY.md", identityAnchor: "ACME s. r. o.",
    };
    expect(request.memoryPath).toBe("memory/MEMORY.md");
    expect(request.identityAnchor).toBe("ACME s. r. o.");
  });

  test("uses one matter request shape for contentious and non-contentious work", () => {
    const request: OnboardingPlanRequest = { action: "matter", clientRoot: "/Office/Clients/Acme", parent: "/Office/Clients/Acme", title: "Share transfer", date: "2026-10-03", kind: "non_contentious", area: "Corporate", jurisdiction: "sk", language: "en" };
    expect(request.action).toBe("matter");
    if (request.action === "matter") expect(request.kind).toBe("non_contentious");
  });
});
