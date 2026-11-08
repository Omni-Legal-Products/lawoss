import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { resolveWorkspaceEndpoint, type LocalServerHandle, type ResolvedWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import { sessionDirectoryWithinWorkspace, useSelectedWorkspaceEndpoint } from "../src/react-app/shell/use-workspace-route-state";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const local: RouteWorkspace = { id: "selected", name: "Synthetic", displayNameResolved: "Synthetic", path: "/synthetic/current", preset: "starter", workspaceType: "local" };

/** Run in the owned native Chromium renderer; no fake DOM or hook dispatcher. */
export function runNativeEndpointStabilityBehavior() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let observed: { endpoint: ResolvedWorkspaceEndpoint | null; directory: string } | undefined;
  let checks = 0;
  function Probe({ workspace, server }: { workspace: RouteWorkspace | null | undefined; server: LocalServerHandle }) {
    const endpoint = useSelectedWorkspaceEndpoint(workspace, server);
    const directory = sessionDirectoryWithinWorkspace(workspace, { directory: "/synthetic/current/task" });
    observed = { endpoint, directory };
    return <output>{directory}</output>;
  }
  const check = (condition: boolean) => { if (!condition) throw new Error(`Mounted endpoint behavior assertion ${checks + 1}`); checks++; };
  const render = (workspace: RouteWorkspace | null | undefined, server: LocalServerHandle = { baseUrl: "http://synthetic-local", token: "local-token" }) => {
    flushSync(() => root.render(<Probe workspace={workspace} server={server} />));
    if (!observed) throw new Error("Actual hook render missing");
    return observed;
  };
  try {
    const initial = render(local).endpoint;
    check(Boolean(initial));
    check(render({ ...local, name: "Changed", displayNameResolved: "Changed", previousSessionIds: ["synthetic-captured"] }).endpoint === initial);
    check(render({ ...local }, { baseUrl: " http://synthetic-local ", token: " local-token " }).endpoint === initial);
    const moved = render({ ...local, path: "/synthetic/moved" });
    check(moved.endpoint === initial);
    check(moved.directory === "/synthetic/moved" && host.textContent === "/synthetic/moved");
    const newAuth = render(local, { baseUrl: "http://synthetic-local", token: "rotated" }).endpoint;
    check(newAuth !== initial && newAuth?.token === "rotated");
    const newServer = render(local, { baseUrl: "http://synthetic-next", token: "rotated" }).endpoint;
    check(newServer !== newAuth && newServer?.baseUrl === "http://synthetic-next");
    const newWorkspace = render({ ...local, id: "other" }, { baseUrl: "http://synthetic-next", token: "rotated" }).endpoint;
    check(newWorkspace !== newServer && newWorkspace?.workspaceId === "other");
    check(render(null).endpoint === null);
    check(render(undefined).endpoint === null);
    check(render(local, { baseUrl: " ", token: "rotated" }).endpoint === null);
    check(render(local).endpoint !== initial);
    const remote: RouteWorkspace = { ...local, id: " rem_worker ", workspaceType: "remote", baseUrl: undefined, legalworkHostUrl: " http://synthetic-remote ", legalworkToken: undefined, legalworkClientToken: " client-token ", legalworkHostToken: "host-fallback", legalworkWorkspaceId: " server-id " };
    const remoteEndpoint = render(remote).endpoint;
    check(remoteEndpoint?.isRemote === true && remoteEndpoint.workspaceId === "server-id" && remoteEndpoint.token === "client-token");
    check(render({ ...remote, baseUrl: null, legalworkToken: null }).endpoint === remoteEndpoint);
    check(render({ ...remote, displayNameResolved: "New remote label", path: "/different" }, { baseUrl: "http://irrelevant-local", token: "ignored" }).endpoint === remoteEndpoint);
    const rotatedHost = render({ ...remote, legalworkHostToken: "rotated-host" }).endpoint;
    check(rotatedHost !== remoteEndpoint && rotatedHost?.hostToken === "rotated-host");
    const removedHost = render({ ...remote, legalworkHostToken: undefined }).endpoint;
    check(removedHost !== rotatedHost && removedHost?.hostToken === undefined);
    const remoteAuth = render({ ...remote, legalworkToken: " rotated-remote " }).endpoint;
    check(remoteAuth !== remoteEndpoint && remoteAuth?.token === "rotated-remote");
    const emptyAuth = render({ ...remote, legalworkToken: "" }).endpoint;
    check(emptyAuth !== remoteAuth && emptyAuth?.token === "");
    const fallbackAuth = render({ ...remote, legalworkToken: undefined, legalworkClientToken: undefined }).endpoint;
    check(fallbackAuth !== emptyAuth && fallbackAuth?.token === "host-fallback");
    const emptyClientAuth = render({ ...remote, legalworkToken: undefined, legalworkClientToken: "" }).endpoint;
    check(emptyClientAuth !== fallbackAuth && emptyClientAuth?.token === "");
    check(render({ ...remote, baseUrl: "" }).endpoint === null);
    const nextRemoteServer = render({ ...remote, baseUrl: "http://other-remote" }).endpoint;
    check(nextRemoteServer?.baseUrl === "http://other-remote");
    const explicitId = render({ ...remote, baseUrl: "http://other-remote", legalworkWorkspaceId: "new-server-id" }).endpoint;
    check(explicitId !== nextRemoteServer && explicitId?.workspaceId === "new-server-id");
    const fallbackId = render({ ...remote, baseUrl: "http://other-remote", legalworkWorkspaceId: " " }).endpoint;
    check(fallbackId !== explicitId && fallbackId?.workspaceId === "worker");
    const explicitAgain = render(remote).endpoint;
    const appOwnerChanged = render({ ...remote, id: "rem_other" }).endpoint;
    check(appOwnerChanged !== explicitAgain && appOwnerChanged?.workspaceId === "server-id");
    const classifiedLocal = render({ ...remote, id: "rem_other", workspaceType: "local" }).endpoint;
    check(classifiedLocal !== appOwnerChanged && classifiedLocal?.isRemote === false && classifiedLocal.workspaceId === "rem_other");
    const noPrefix = render({ ...remote, id: "plain-id" }).endpoint;
    check(noPrefix?.isRemote === false && noPrefix.workspaceId === "plain-id");
    return { schema: 1, checks, actualMountedHook: true };
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
}

// This same file is Vite-importable for the mounted hook checks; Bun test
// registration is strictly outside the browser branch, with no runtime shim.
if (typeof document === "undefined") {
  const testModule = "bun:test";
  const { expect, test } = await import(/* @vite-ignore */ testModule);
  const httpModule = "node:http";
  const { createServer }: typeof import("node:http") = await import(/* @vite-ignore */ httpModule);
  async function fixture(run: (baseUrl: string, requests: Array<{ url: string | undefined; authorization: string | undefined; hostToken: string | string[] | undefined }>) => Promise<void>) {
    const requests: Array<{ url: string | undefined; authorization: string | undefined; hostToken: string | string[] | undefined }> = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url, authorization: request.headers.authorization, hostToken: request.headers["x-legalwork-host-token"] });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: "Dokumenty", entries: [], enforcedWithin: "Dokumenty" }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("HTTP fixture address missing");
      await run(`http://127.0.0.1:${address.port}`, requests);
    } finally {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
  test("local endpoint sends the trimmed current owner and local auth, ignoring remote fields", async () => {
    await fixture(async (baseUrl, requests) => {
      const endpoint = resolveWorkspaceEndpoint({ ...local, id: " selected ", baseUrl: "http://wrong", legalworkToken: "wrong", legalworkWorkspaceId: "wrong" }, { baseUrl: ` ${baseUrl} `, token: " local-auth " });
      expect(endpoint?.isRemote).toBe(false);
      await endpoint?.client.listWorkspaceDirectory(endpoint.workspaceId, "Dokumenty", { within: "Dokumenty" });
      expect(requests).toEqual([{ url: "/workspace/selected/files/list?path=Dokumenty&within=Dokumenty", authorization: "Bearer local-auth", hostToken: undefined }]);
      expect(endpoint?.opencodeBaseUrl).toBe(`${baseUrl}/workspace/selected/opencode`);
    });
  });
  test("local owner client is reused with its host capability and survives metadata-only endpoint allocation", async () => {
    await fixture(async (baseUrl, requests) => {
      const client = createLegalworkServerClient({baseUrl,token:"local-auth",hostToken:"local-host"});
      const endpoint = resolveWorkspaceEndpoint(local,{baseUrl,token:"local-auth",hostToken:"local-host",localClient:client});
      expect(endpoint?.client).toBe(client);expect(endpoint?.hostToken).toBe("local-host");
      await endpoint?.client.listWorkspaceDirectory(endpoint.workspaceId,"Dokumenty");
      expect(requests.at(-1)).toEqual({url:"/workspace/selected/files/list?path=Dokumenty",authorization:"Bearer local-auth",hostToken:"local-host"});
    });
  });
  // Upstream v0.3.0 retired remote agent workspaces: an archived remote record never resolves, so it cannot
  // borrow the local server or its host capability.
  test("retired remote records never resolve an endpoint or borrow the local host capability", () => {
    const remote = { ...local, id: " rem_worker ", workspaceType: "remote" } as unknown as RouteWorkspace;
    expect(resolveWorkspaceEndpoint(remote, { baseUrl: "http://local", token: "local-auth", hostToken: "never-borrow-local-host" })).toBeNull();
  });
  test("missing workspace and empty chosen bases disconnect without borrowing fallback servers", () => {
    expect(resolveWorkspaceEndpoint(null, { baseUrl: "http://local", token: "auth" })).toBeNull();
    expect(resolveWorkspaceEndpoint(undefined, { baseUrl: "http://local", token: "auth" })).toBeNull();
    expect(resolveWorkspaceEndpoint(local, { baseUrl: " ", token: "auth" })).toBeNull();
    expect(resolveWorkspaceEndpoint({ ...local, id: "rem_remote", workspaceType: "remote", baseUrl: "", legalworkHostUrl: "http://fallback" }, { baseUrl: "http://local", token: "auth" })).toBeNull();
  });
  test("current root rejects the former session directory after a metadata refresh moves the workspace", () => {
    expect(sessionDirectoryWithinWorkspace(local, { directory: "/synthetic/current/task" })).toBe("/synthetic/current/task");
    expect(sessionDirectoryWithinWorkspace({ ...local, path: "/synthetic/moved" }, { directory: "/synthetic/current/task" })).toBe("/synthetic/moved");
  });
}
