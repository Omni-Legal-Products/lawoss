import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workingCopy } from "../file-storage/working-copy.js";
import { ApiError } from "../errors.js";
import { LegalWorkStorageTools } from "./legalwork-storage-tools.js";

type Call = { url: URL; method: string; body: unknown; headers: Headers };
/** The chat every tool call below is made from. */
const SESSION = "ses_storage";
async function fixture(
  run: (value: {
    plugin: Awaited<ReturnType<typeof LegalWorkStorageTools>>;
    directory: string;
    outside: string;
    calls: Call[];
  }) => Promise<void>,
  linked = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "storage-agent-"));
  const outside = await mkdtemp(join(tmpdir(), "storage-outside-"));
  await mkdir(join(directory, "nested"));
  await writeFile(join(outside, "private.txt"), "outside workspace");
  const calls: Call[] = [];
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  const previousToken = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
  const previousServerToken = process.env.LEGALWORK_SERVER_TOKEN;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      // Only the chat-bound agent credential reaches the server, never a server-wide token.
      expect(request.headers.get("x-legalwork-wiki-agent-token")).toBe("client-token");
      expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe(SESSION);
      expect(request.headers.has("x-legalwork-wiki-agent-directory")).toBe(true);
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.headers.has("x-legalwork-host-token")).toBe(false);
      const url = new URL(request.url);
      const body: unknown = request.method === "GET" ? undefined : await request.json();
      calls.push({ url, method: request.method, body, headers: request.headers });
      if (url.pathname === "/workspaces")
        return Response.json({
          items: [
            { id: "outer", path: directory },
            { id: "inner", path: join(directory, "nested") },
          ],
        });
      if (url.pathname.endsWith("/roots"))
        return Response.json({
          teamError: "Team connections could not sync.",
          roots: [
            ...(linked ? [{ id: "project:linked-folder", name: "Project matter", kind: "linked", writable: false }] : []),
            { id: "one", name: "Same name", kind: "s3", writable: true },
            { id: "two", name: "Same name", kind: "webdav", writable: false },
          ],
        });
      if (url.pathname.endsWith("/search")) {
        if (url.pathname.includes("/unsupported/"))
          return Response.json(
            { code: "storage_search_unsupported", message: "Browse folders instead." },
            { status: 400 },
          );
        if (url.pathname.includes("/offline/"))
          return Response.json({ code: "storage_unavailable", message: "Storage is unavailable." }, { status: 502 });
        return Response.json({
          entries: [{ path: "Matters/Contract.docx", name: "Contract.docx", kind: "file", size: 42, modifiedAt: null }],
          ...(url.searchParams.has("cursor")
            ? {}
            : { nextCursor: `next-${url.pathname.includes("/one/") ? "one" : "two"}` }),
        });
      }
      if (url.pathname.endsWith("/filename-search")) {
        if (url.pathname.includes("/offline/"))
          return Response.json({ code: "storage_unavailable", message: "Storage is unavailable." }, { status: 502 });
        const cursor = body && typeof body === "object" && "cursor" in body ? body.cursor : undefined;
        return Response.json(
          cursor
            ? {
                entries: [
                  {
                    path: "Firm DMS/MAT-00005/Activity.txt",
                    name: "Activity.txt",
                    kind: "file",
                    size: 42,
                    modifiedAt: null,
                  },
                ],
                scanned: 1,
                complete: true,
              }
            : {
                entries: [],
                scanned: 1000,
                complete: false,
                nextCursor: `next-${url.pathname.includes("/one/") ? "one" : "two"}`,
              },
        );
      }
      if (url.pathname.endsWith("/capabilities"))
        return Response.json({
          read: true,
          write: false,
          createFolder: false,
          search: { modes: ["name"], pagination: false },
        });
      if (url.pathname.endsWith("/checkout")) {
        try {
          const copy = await workingCopy(directory, "Contract.docx");
          await writeFile(copy.path, Buffer.from([0, 255, 1, 2]));
          return Response.json({
            localPath: copy.relativePath,
            size: 4,
            contentType: "application/octet-stream",
            version: "v1",
            writable: true,
          });
        } catch (error) {
          if (error instanceof ApiError)
            return Response.json({ code: error.code, message: error.message }, { status: error.status });
          throw error;
        }
      }
      if (url.pathname.endsWith("/from-workspace")) return Response.json({ ok: true, version: "v2" });
      return Response.json({ code: "not_found", message: "Not found." }, { status: 404 });
    },
  });
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "client-token";
  process.env.LEGALWORK_SERVER_TOKEN = "server-wide-token";
  try {
    await run({ plugin: await LegalWorkStorageTools(), directory, outside, calls });
  } finally {
    await server.stop(true);
    if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL;
    else process.env.LEGALWORK_SERVER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN;
    else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previousToken;
    if (previousServerToken === undefined) delete process.env.LEGALWORK_SERVER_TOKEN;
    else process.env.LEGALWORK_SERVER_TOKEN = previousServerToken;
    await rm(directory, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

test("discovers stable connection IDs in the closest workspace without exposing configuration", async () => {
  await fixture(async ({ plugin, directory, outside, calls }) => {
    const result = JSON.parse(
      await plugin.tool.storage_list_connections.execute({}, { directory: join(directory, "nested"), sessionID: SESSION }),
    );
    expect(result.connections.map((item: { connection_id: string }) => item.connection_id)).toEqual(["one", "two"]);
    expect(result.team_sync_error).toBe("Team connections could not sync.");
    expect(calls.at(-1)?.url.pathname).toBe("/workspace/inner/storage/roots");
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get("x-legalwork-wiki-agent-directory")).toBe(
      encodeURIComponent(await realpath(join(directory, "nested"))),
    );
    const missing = JSON.parse(await plugin.tool.storage_list_connections.execute({}, { directory: outside, sessionID: SESSION }));
    expect(missing.code).toBe("storage_workspace_unknown");
    expect(calls).toHaveLength(3);
    // Without its directory or its chat a call is not connected, so it never falls back to a workspace.
    expect(JSON.parse(await plugin.tool.storage_list_connections.execute({}, { sessionID: SESSION })).code).toBe(
      "storage_connection_unavailable",
    );
    expect(JSON.parse(await plugin.tool.storage_list_connections.execute({}, { directory })).code).toBe(
      "storage_connection_unavailable",
    );
    expect(calls).toHaveLength(3);
  });
});

test("searches multiple sources with distinct identity, errors and continuation cursors", async () => {
  await fixture(async ({ plugin, directory, calls }) => {
    const result = JSON.parse(
      await plugin.tool.storage_search.execute(
        {
          connection_ids: ["one", "two", "one", "unsupported", "offline"],
          mode: "name",
          query: "Contract & #1",
          path: "Matters",
        },
        { directory, sessionID: SESSION },
      ),
    );
    expect(result.results.map((item: { connection_id: string }) => item.connection_id)).toEqual([
      "one",
      "two",
      "unsupported",
      "offline",
    ]);
    expect(result.results[0].page.entries).toEqual(result.results[1].page.entries);
    expect(result.results[2]).toMatchObject({ ok: false, code: "storage_search_unsupported" });
    expect(result.results[3]).toMatchObject({ ok: false, code: "storage_unavailable" });
    const searches = calls.filter((call) => call.url.pathname.endsWith("/search"));
    expect(searches).toHaveLength(4);
    expect(
      searches.every(
        (call) =>
          call.url.searchParams.get("query") === "Contract & #1" && call.url.searchParams.get("path") === "Matters",
      ),
    ).toBe(true);
    const next = JSON.parse(
      await plugin.tool.storage_search.execute(
        {
          connection_ids: ["one", "two"],
          mode: "name",
          query: "Contract & #1",
          path: "Matters",
          cursors: { one: "next-one", two: "next-two" },
        },
        { directory, sessionID: SESSION },
      ),
    );
    expect(next.results.every((item: { page: { nextCursor?: string } }) => !item.page.nextCursor)).toBe(true);
    // The two sources are searched in parallel; their request order is not part of the contract.
    expect(calls.slice(-2).map((call) => call.url.searchParams.get("cursor")).sort()).toEqual(["next-one", "next-two"]);
  });
});

test("defaults matter discovery to recursive paths across providers without native capability checks", async () => {
  await fixture(async ({ plugin, directory, calls }) => {
    const args = { connection_ids: ["one", "two", "one", "offline"], query: "MAT-00005" };
    const first = JSON.parse(await plugin.tool.storage_search.execute(args, { directory, sessionID: SESSION }));
    expect(first).toMatchObject({ query: "MAT-00005", mode: "path", path: "", content_searched: false });
    expect(first.results).toHaveLength(3);
    expect(first.results[0]).toMatchObject({
      connection_id: "one",
      ok: true,
      page: { entries: [], complete: false, nextCursor: "next-one" },
    });
    expect(first.results[2]).toMatchObject({ connection_id: "offline", ok: false, code: "storage_unavailable" });
    expect(calls.filter((call) => call.method === "POST").map((call) => call.body)).toEqual(
      Array.from({ length: 3 }, () => ({ query: "MAT-00005", path: "", match: "path" })),
    );
    expect(
      calls.some((call) => call.url.pathname.endsWith("/capabilities") || call.url.pathname.endsWith("/search")),
    ).toBe(false);
    const next = JSON.parse(
      await plugin.tool.storage_search.execute(
        { ...args, connection_ids: ["one", "two"], cursors: { one: "next-one", two: "next-two" } },
        { directory, sessionID: SESSION },
      ),
    );
    expect(
      next.results.map((item: { connection_id: string; page: { complete: boolean } }) => [
        item.connection_id,
        item.page.complete,
      ]),
    ).toEqual([
      ["one", true],
      ["two", true],
    ]);
    // Parallel sources: compare the two requests regardless of their order.
    expect(calls.slice(-2).map((call) => call.body)).toHaveLength(2);
    expect(calls.slice(-2).map((call) => call.body)).toEqual(expect.arrayContaining([
      { query: "MAT-00005", path: "", match: "path", cursor: "next-one" },
      { query: "MAT-00005", path: "", match: "path", cursor: "next-two" },
    ]));
    await plugin.tool.storage_search_filenames.execute({ query: "Activity", connection_ids: ["one"] }, { directory, sessionID: SESSION });
    expect(calls.at(-1)?.body).toEqual({ query: "Activity", path: "" });
  });
});

test("downloads binary documents to editable workspace copies and requires explicit versioned save-back", async () => {
  await fixture(async ({ plugin, directory, calls }) => {
    const source = { connection_id: "one", path: "Matters/Contract.docx" };
    const read = JSON.parse(await plugin.tool.storage_read_file.execute(source, { directory, sessionID: SESSION }));
    expect(read.local_path).toStartWith(".legalwork/storage-downloads/");
    expect(await readFile(join(directory, read.local_path))).toEqual(Buffer.from([0, 255, 1, 2]));
    expect(calls.every((call) => call.method === "GET" || call.url.pathname.endsWith("/checkout"))).toBe(true);
    await writeFile(join(directory, read.local_path), "edited document bytes");
    const saved = JSON.parse(
      await plugin.tool.storage_write_file.execute(
        { ...source, mode: "replace", local_path: read.local_path, version: read.version },
        { directory, sessionID: SESSION },
      ),
    );
    expect(saved.result.version).toBe("v2");
    expect(calls.at(-1)?.body).toMatchObject({
      version: "v1",
      localPath: read.local_path,
      mode: "replace",
    });
    expect(
      JSON.parse(
        await plugin.tool.storage_write_file.execute({ ...source, mode: "replace", content: "new" }, { directory, sessionID: SESSION }),
      ).code,
    ).toBe("storage_version_required");
    expect(
      JSON.parse(
        await plugin.tool.storage_write_file.execute(
          { ...source, mode: "create", content: "new", local_path: read.local_path },
          { directory, sessionID: SESSION },
        ),
      ).code,
    ).toBe("storage_content_required");
  });
});

test("confines uploads and downloads to the task workspace, including symlink targets", async () => {
  await fixture(async ({ plugin, directory, outside, calls }) => {
    await symlink(join(outside, "private.txt"), join(directory, "linked.txt"));
    const source = { connection_id: "one", path: "Contract.docx" };
    expect(
      JSON.parse(
        await plugin.tool.storage_write_file.execute(
          { ...source, mode: "create", local_path: "linked.txt" },
          { directory, sessionID: SESSION },
        ),
      ).code,
    ).toBe("storage_local_path_outside_workspace");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    await symlink(outside, join(directory, ".legalwork"));
    expect(JSON.parse(await plugin.tool.storage_read_file.execute(source, { directory, sessionID: SESSION })).code).toBe(
      "storage_local_path_outside_workspace",
    );
    expect(
      JSON.parse(await plugin.tool.storage_read_file.execute({ ...source, path: "../outside" }, { directory, sessionID: SESSION })).code,
    ).toBe("invalid_storage_path");
  });
});

test("omitted search connections default exclusively to project folder aliases", async () => {
  await fixture(async ({ plugin, directory, calls }) => {
    const result = JSON.parse(await plugin.tool.storage_search.execute({ query: "agreement" }, { directory, sessionID: SESSION }));
    expect(result.results.map((entry: { connection_id: string }) => entry.connection_id)).toEqual(["project:linked-folder"]);
    const searches = calls.filter((call) => call.url.pathname.endsWith("/filename-search"));
    expect(searches).toHaveLength(1);
    expect(searches[0]?.url.pathname).toContain("project%3Alinked-folder");
    expect(searches[0]?.body).toMatchObject({ path: "", query: "agreement" });
  }, true);
});
