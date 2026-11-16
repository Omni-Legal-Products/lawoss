import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createManagedOpencodeServer } from "../managed-opencode.js";
import { verifiedTestEngine } from "../opencode-candidate.test-support.js";

// Skutočný proces enginu (falošný binár) v samostatnom Bun procese, ako managed-opencode.test.ts:
// iné testy nesmú podstrčiť fetch ani hodiny.
const FAKE_ENGINE = (version: string) => `#!${process.execPath}
const fs = require("node:fs");
const http = require("node:http");
const { spawn } = require("node:child_process");
const out = process.env.FAKE_ENGINE_OUT;
const mcp = spawn("/bin/sh", ["-c", "sleep 60"], { stdio: "ignore" });
fs.writeFileSync(out + ".mcp", String(mcp.pid));
const port = process.argv[process.argv.indexOf("--port") + 1];
process.stdout.write("server listening on http://127.0.0.1:" + port + "\\n");
http.createServer((request, response) => {
  if (request.headers.authorization !== "Basic " + Buffer.from("opencode:" + process.env.OPENCODE_PASSWORD).toString("base64")) return response.writeHead(401).end();
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/experimental/migration/v1") return response.end(JSON.stringify({ status: "completed" }));
  if (request.url === "/api/info") return response.end(JSON.stringify({ version: ${JSON.stringify(version)}, pid: process.pid }));
  response.writeHead(404).end();
}).listen(Number(port), "127.0.0.1");
setInterval(() => {}, 1 << 30);
`;

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

if (process.env.LAWOSS_ENGINE_EXIT_FIXTURE !== "1") {
  test("#454: neočakávané ukončenie enginu v izolovanom procese", async () => {
    const child = Bun.spawn([process.execPath, "test", "--timeout", "25000", import.meta.filename], {
      env: { ...process.env, LAWOSS_ENGINE_EXIT_FIXTURE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stdout + stderr).toBe(0);
    expect(stdout + stderr).toContain("1 pass");
  }, 60_000);
} else {
  test.skipIf(process.platform === "win32")("#454: pád enginu ukončí jeho siroty a dostane ho aj neskôr pridaný poslucháč", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lawoss-engine-exit-"));
    try {
      const { bin, candidateBuild } = await verifiedTestEngine(dir, FAKE_ENGINE);
      const out = join(dir, "engine");
      const server = await createManagedOpencodeServer({ bin, candidateBuild, cwd: dir, env: { FAKE_ENGINE_OUT: out } });
      const mcp = Number(readFileSync(out + ".mcp", "utf8"));
      expect(alive(mcp)).toBe(true);
      let early = 0;
      server.onUnexpectedExit?.(() => { early++; });
      process.kill(server.pid ?? 0, "SIGKILL");
      for (let i = 0; i < 100 && early === 0; i++) await Bun.sleep(50);
      expect(early).toBe(1);
      expect(alive(mcp)).toBe(false);
      // Poslucháč pridaný až po páde (napr. po importe prihlásení) sa nestratí.
      let late = 0;
      server.onUnexpectedExit?.(() => { late++; });
      await Bun.sleep(20);
      expect(late).toBe(1);
      expect(early).toBe(1);
      await server.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
