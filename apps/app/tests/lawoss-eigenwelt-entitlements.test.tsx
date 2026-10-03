import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { useEigenweltEntitlements } from "../src/react-app/domains/connections/eigenwelt-entitlements";

test("hidden Eigenwelt account does not call the entitlement endpoint, including refetch", async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client = createLegalworkServerClient({ baseUrl: "http://localhost:1" });
  let endpointCalls = 0;
  client.eigenweltEntitlements = async () => {
    endpointCalls += 1;
    throw new Error("the hidden account endpoint must not be called");
  };
  let refetch: (() => Promise<unknown>) | null = null;

  function Probe() {
    const query = useEigenweltEntitlements({ client, workspaceId: "workspace", enabled: true });
    refetch = query.refetch;
    return null;
  }

  renderToStaticMarkup(<QueryClientProvider client={cache}><Probe /></QueryClientProvider>);
  expect(refetch).not.toBeNull();
  await refetch!();

  expect(endpointCalls).toBe(0);
  cache.clear();
});
