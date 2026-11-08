import { expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { resolvePluginImports } from "./plugin-imports.js";

test("GitHub folder sources pin snapshots, distinguish subdirectories and preserve complete assets without leaking API credentials", async () => {
  const previous = process.env.LEGALWORK_GITHUB_API_BASE;
  const paths: string[] = [];
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) {
    const url = new URL(request.url); paths.push(url.pathname);
    expect(request.headers.get("authorization")).toBeNull();
    if (url.pathname === "/repos/team/plugins") return Response.json({ default_branch: "release/v1" });
    if (decodeURIComponent(url.pathname) === "/repos/team/plugins/commits/release/v1") return Response.json({ sha: "a".repeat(40) });
    if (url.pathname.endsWith(`/zipball/${"a".repeat(40)}`)) return new Response(zipSync(Object.fromEntries(["first", "second"].flatMap(folder => [
      [`snapshot/${folder}/.claude-plugin/plugin.json`, strToU8('{"name":"same","version":"1.0.0"}')],
      [`snapshot/${folder}/skills/review/SKILL.md`, strToU8("---\nname: review\ndescription: Review\n---\nRead references/check.md.")],
      [`snapshot/${folder}/skills/review/references/check.md`, strToU8(`Complete ${folder} asset`)],
    ]))));
    return new Response("Missing", { status: 404 });
  } });
  process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${server.port}`;
  try {
    const [first] = await resolvePluginImports({ source: { provider: "claude", url: "https://github.com/team/plugins/tree/release/v1/first", ref: "release/v1" }, scope: "project" }, "/import-test");
    const [second] = await resolvePluginImports({ source: { provider: "claude", url: "https://github.com/team/plugins", ref: "release/v1", directory: "second" }, scope: "project" }, "/import-test");
    expect(first?.preview.provenance).toMatchObject({ directory: "first", revision: "a".repeat(40), ref: "release/v1" });
    expect(second?.preview.id).not.toBe(first?.preview.id);
    expect(first?.resourceFiles.some(file => file.path.endsWith("references/check.md") && new TextDecoder().decode(file.bytes) === "Complete first asset")).toBe(true);
    expect(paths.filter(path => path.includes("zipball"))).toHaveLength(1);
    expect(paths.some(path => path.includes("zipball/release"))).toBe(false);
  } finally { server.stop(true); if (previous === undefined) delete process.env.LEGALWORK_GITHUB_API_BASE; else process.env.LEGALWORK_GITHUB_API_BASE = previous; }
});

test("rate-limited real-source downloads explain retry instead of suggesting broken credentials", async () => {
  const previous = process.env.LEGALWORK_GITHUB_API_BASE;
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("Retry later", { status: 429 }) });
  process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${server.port}`;
  try { await expect(resolvePluginImports({ source: { provider: "chatgpt", url: "https://github.com/team/plugins" }, scope: "project" }, "/import-test")).rejects.toThrow("rate limiting"); }
  finally { server.stop(true); if (previous === undefined) delete process.env.LEGALWORK_GITHUB_API_BASE; else process.env.LEGALWORK_GITHUB_API_BASE = previous; }
});
