// LAWOSS #552: okno hostiteľa skladá text verejnej požiadavky AI v jazyku rozhrania zo štruktúrovaných údajov.
import { rm } from "node:fs/promises";
import { afterEach, describe, expect, test } from "bun:test";
import { ApprovalService } from "../approvals.js";
import { publicAiReview } from "./ai-public-context.js";
import { createHostDecisionPort } from "./host-decision.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true}); });

const body = JSON.stringify({model: "qwen", messages: [{role: "system", content: "S"}, {role: "user", content: "PUBLIC-CANARY"}]});

describe("#552 žiadosť o schválenie verejnej požiadavky AI", () => {
  test("popis je presne serializovaný kontext a cieľ ide štruktúrovane, nie ako anglická veta", () => {
    const review = publicAiReview("http://localhost:11434/v1/chat/completions", {providerId: "ollama", modelId: "qwen"}, body);
    expect(review.description).toBe(JSON.stringify(JSON.parse(body), null, 2));
    expect(review.publicAi).toEqual({origin: "http://localhost:11434", endpoint: "http://localhost:11434/v1/chat/completions", providerId: "ollama", modelId: "qwen"});
  });

  test("port rozhodnutí hostiteľa odovzdá štruktúrované údaje do žiadosti pre okno hostiteľa", async () => {
    const fixture = await syntheticHostConfig(); roots.push(fixture.root);
    const approvals = new ApprovalService({mode: "auto", timeoutMs: 1000});
    try {
      const review = publicAiReview("https://api.example.test/v1/chat/completions", {providerId: "p", modelId: "m"}, body);
      const decision = createHostDecisionPort(approvals, fixture.config).requestDecision({workspaceId: "__host_public_ai__", action: "ai.public.synthetic",
        operationId: "op", bindingHash: "b", ...review, readCurrentBindingHash: async () => "b"});
      expect(approvals.list()[0]).toMatchObject({publicAi: review.publicAi, description: review.description});
      approvals.respondNative(approvals.list()[0].id, "deny");
      expect((await decision).decision).toBe("deny");
    } finally { approvals.dispose(); }
  });
});
