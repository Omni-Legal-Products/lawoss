import { expect, spyOn, test } from "bun:test";
import { EmailDraftSchema } from "@legalwork/types/email-draft";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";

test("mailbox reload uses its own owner-authenticated endpoint and sends only the local revision", async () => {
  const draft = EmailDraftSchema.parse({ id: "b26d21f3-85ad-4c9f-a6ec-5249b2da280a", workspaceId: "project", revision: "e24143f1-b8b9-4a44-a497-8a3f2b3772b7", path: ".legalwork/draft.eml", updatedAt: 0,
    to: "client@example.com", body: "Private email content", connectorTarget: { connectorId: "gmail", connectionId: "local-account" }, delivery: { state: "saved", id: "private-provider-id" } });
  const requests: { url: string; method: string | undefined; headers: Headers; body: unknown }[] = [];
  const original = globalThis.fetch;
  const mock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    return Response.json({ draft });
  }, { preconnect: original.preconnect }));
  try {
    const client = createLegalworkServerClient({ baseUrl: "http://local.invalid", token: "owner-token", hostToken: "host-token" });
    expect(await client.reloadEmailDraft("project", draft)).toEqual({ draft });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`http://local.invalid/workspace/project/connector-drafts/email/${draft.id}/reload`);
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers.get("X-LegalWork-Host-Token")).toBe("host-token");
    expect(requests[0].body).toEqual({ revision: draft.revision });
  } finally { mock.mockRestore(); }
});
