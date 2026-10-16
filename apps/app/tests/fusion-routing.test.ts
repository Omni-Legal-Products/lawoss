import { describe, expect, test } from "bun:test";

import {
  buildCandidateSystemPrompt,
  buildFusionDelegationSystemPrompt,
  FUSION_CANDIDATE_AGENT,
  isFusionCandidateAgentName,
} from "../src/react-app/domains/session/fusion/fusion-prompt";

describe("fusion task-tool prompts", () => {
  test("uses subagents for substantive legal judgment, not file search", () => {
    const prompt = buildFusionDelegationSystemPrompt({
      candidateModels: [
        { providerID: "opencode", modelID: "big-pickle" },
        { providerID: "deepseek", modelID: "v4-flash" },
      ],
    });
    expect(prompt).toContain("normal OpenCode task tool");
    expect(prompt).toContain(FUSION_CANDIDATE_AGENT);
    expect(prompt).toContain("Do not use Fusion for mechanical context gathering");
    expect(prompt).toContain("Do not use Fusion for the file search itself");
    expect(prompt).toContain("qualitatively different legal or strategic analysis");
    expect(prompt).toContain("Before returning any substantive work product such as a review, memo, draft");
    expect(prompt).toContain("you must use Fusion to run the same complete substantive task through three submodels");
    expect(prompt).toContain("Then create the final result yourself from those independent candidate outputs");
    expect(prompt).toContain("The task prompt for all three calls must be substantively identical");
    expect(prompt).toContain("Do not split the candidates by issue, role, perspective, jurisdiction, risk category, or drafting angle");
    expect(prompt).toContain("ordinary conversation");
    expect(prompt).toContain("Do not invent numbered or model-specific subagent_type values");
    expect(prompt).toContain("Do not send the raw user message");
    expect(prompt).toContain("non-ambiguous work order");
    expect(prompt).toContain("Do not ask the subagent to find, locate, or identify the file");
  });

  test("does not expose numbered candidate agent types as valid agents", () => {
    const prompt = buildFusionDelegationSystemPrompt({
      candidateModels: [
        { providerID: "opencode", modelID: "big-pickle" },
      ],
    });
    expect(isFusionCandidateAgentName("fusion-candidate-1")).toBe(false);
    expect(isFusionCandidateAgentName(FUSION_CANDIDATE_AGENT)).toBe(true);
    expect(prompt).toContain(`Use subagent_type ${FUSION_CANDIDATE_AGENT}`);
    expect(prompt).toContain("do not use fusion-candidate-1");
  });

  test("candidate agent prompt forbids clarification-only replies", () => {
    const prompt = buildCandidateSystemPrompt(null, "Review the NDA for risk issues.");
    expect(prompt).toContain("Do not ask the user clarifying questions");
    expect(prompt).toContain("Review the NDA for risk issues.");
  });
});

import { runFusionSend } from "../src/react-app/domains/session/fusion/fusion-controller";
import type { Client } from "../src/app/types";

test("fusion forwards optional native message identity only to its existing main prompt", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = { session: {
    messages: async () => ({ data: [] }),
    promptAsync: async (request: Record<string, unknown>) => {
      requests.push(request);
      return { error: { name: "APIError", message: "synthetic rejection" } };
    },
  } } as unknown as Client;
  const candidateModels = [{ providerID: "candidate", modelID: "selected" }];
  const input = { client, mainSessionId: "main", directory: "/root/work", parts: [{ type: "text" as const, text: "task" }], userText: "task", candidateModels, mainModel: { providerID: "main", modelID: "chosen" }, agent: "agent", variant: "variant" };
  await expect(runFusionSend({ ...input, messageID: "msg_000000000001abcdefghijklmn" })).rejects.toThrow();
  await expect(runFusionSend(input)).rejects.toThrow();
  expect(requests).toHaveLength(2);
  expect(requests[0].messageID).toBe("msg_000000000001abcdefghijklmn");
  expect(requests[1]).not.toHaveProperty("messageID");
  for (const request of requests) {
    expect(request.sessionID).toBe("main");
    expect(request.directory).toBe(input.directory);
    expect(request.model).toEqual(input.mainModel);
    expect(request.agent).toBe("agent");
    expect(request.variant).toBe("variant");
    // Od LegalWork v0.2.9 ide kontext Fusion ako skrytá časť správy, nie ako `system`.
    expect(request.parts).toEqual([...input.parts, expect.objectContaining({ type: "text", synthetic: true, text: expect.stringContaining("candidate/selected") })]);
    expect(request).not.toHaveProperty("system");
  }
  expect(candidateModels).toEqual([{ providerID: "candidate", modelID: "selected" }]);
});
