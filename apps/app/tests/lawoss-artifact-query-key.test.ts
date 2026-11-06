// LAWOSS (#367): súbor len na čítanie sa každé 2 s nesmie sťahovať znova, keď sa nezmenil.
import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { artifactQueryOptions } from "../src/react-app/domains/session/artifacts/artifact-query";
import type { OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";

const target = { id: "file:spis/zmluva.pdf", kind: "file", value: "spis/zmluva.pdf", name: "zmluva.pdf", preview: "pdf" } as OpenTarget; // Fixture: len polia, ktoré čítanie používa.
const bytes = new TextEncoder().encode("SYN zmluva").buffer;
const client = new QueryClient();
afterEach(() => client.clear());

function fakeServer(stat: { exists: boolean; kind?: "file"; size?: number; updatedAt?: number } | null = { exists: true, kind: "file", size: bytes.byteLength, updatedAt: 100 }) {
  const calls = { download: 0, stat: 0 };
  return {
    calls,
    server: {
      baseUrl: "http://127.0.0.1:1234",
      readWorkspaceFile: async () => { throw new Error("binary file read as text"); },
      statWorkspaceFile: async () => { calls.stat += 1; if (!stat) throw new Error("older server"); return stat; },
      downloadWorkspaceFile: async () => { calls.download += 1; return { data: bytes.slice(0), contentType: "application/pdf", updatedAt: 100 }; },
    } as unknown as Parameters<typeof artifactQueryOptions>[0]["client"], // Fixture: len metódy, ktoré čítanie volá.
  };
}

async function readTwice(server: Parameters<typeof artifactQueryOptions>[0]["client"], generation: number | undefined) {
  const options = artifactQueryOptions({ queryClient: client, client: server, workspaceId: "workspace-a", target, generation, localReadOnly: true, isReader: () => false });
  // Skutočný pozorovateľ query, ako `useQuery` v paneli; refetch je to, čo robí interval.
  const observer = new QueryObserver(client, { ...options, refetchInterval: false });
  const stop = observer.subscribe(() => undefined);
  try {
    const first = await observer.refetch();
    const second = await observer.refetch();
    return { first: first.data, second: second.data };
  } finally { stop(); }
}

for (const generation of [undefined, 3]) {
  test(`nezmenený súbor sa pri ďalšom čítaní nesťahuje (generácia ${String(generation)})`, async () => {
    const { calls, server } = fakeServer();
    const { first, second } = await readTwice(server, generation);
    expect(calls).toEqual({ download: 1, stat: 1 });
    // Tá istá hodnota: náhľad si nechá URL, posun aj prehrávanie.
    expect(second).toBe(first);
  });
}

test("zmenený súbor sa stiahne znova", async () => {
  const { calls, server } = fakeServer({ exists: true, kind: "file", size: bytes.byteLength, updatedAt: 200 });
  await readTwice(server, undefined);
  expect(calls).toEqual({ download: 2, stat: 1 });
});

test("starší server bez stat stále sťahuje", async () => {
  const { calls, server } = fakeServer(null);
  await readTwice(server, undefined);
  expect(calls).toEqual({ download: 2, stat: 1 });
});
