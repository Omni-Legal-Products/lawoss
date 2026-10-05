import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptUrl = new URL("./report-download-stats.mjs", import.meta.url).href;

// Exercise the CLI, replacing only external HTTP so tests cannot send data.
function runStats(env = {}, args = []) {
  const harness = `
    const requests = [];
    process.on("exit", () => console.log("REQUESTS=" + JSON.stringify(requests)));
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, method: options.method ?? "GET", body: options.body });
      if (options.method === "POST") return Response.json({ status: 1 });
      if (url.includes("/releases?")) return Response.json([{
        tag_name: "v0.2.1-lawoss.1", draft: false, prerelease: false,
        published_at: "2026-10-03T00:00:00Z", assets: [{
          name: "lawoss-linux-x86_64-0.2.1-lawoss.1.AppImage", download_count: 7
        }]
      }]);
      if (url.endsWith("/traffic/views")) return Response.json({ views: [] });
      if (url.endsWith("/traffic/clones")) return Response.json({ clones: [] });
      if (url.endsWith("/traffic/popular/referrers")) return Response.json([]);
      throw new Error("Unexpected HTTP request: " + url);
    };
    process.argv.push(...${JSON.stringify(args)});
    await import(${JSON.stringify(scriptUrl)});
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", harness],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        ...env,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const requests = JSON.parse(result.stdout.match(/^REQUESTS=(.*)$/m)[1]);
  return { requests, stdout: result.stdout };
}

for (const [name, env] of [
  ["absent configuration", {}],
  [
    "legacy configuration only",
    {
      LEGALWORK_POSTHOG_KEY: "test-legacy-key",
      LEGALWORK_POSTHOG_HOST: "https://legacy.invalid",
    },
  ],
  ["missing LAWOSS host", { LAWOSS_POSTHOG_KEY: "test-lawoss-key" }],
  ["missing LAWOSS key", { LAWOSS_POSTHOG_HOST: "https://lawoss.invalid" }],
  [
    "blank LAWOSS key",
    {
      LAWOSS_POSTHOG_KEY: "  ",
      LAWOSS_POSTHOG_HOST: "https://lawoss.invalid",
    },
  ],
]) {
  test(`statistics skip all HTTP with ${name}`, () => {
    const result = runStats(env);
    assert.deepEqual(result.requests, []);
    assert.match(result.stdout, /skipp/i);
  });
}

test("explicit LAWOSS configuration sends the fork snapshot only to its configured host", () => {
  const { requests } = runStats({
    LAWOSS_POSTHOG_KEY: " test-lawoss-key ",
    LAWOSS_POSTHOG_HOST: " https://lawoss.invalid/// ",
    LEGALWORK_POSTHOG_KEY: "test-legacy-key",
    LEGALWORK_POSTHOG_HOST: "https://legacy.invalid",
  });
  const posts = requests.filter(({ method }) => method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://lawoss.invalid/batch/");
  const payload = JSON.parse(posts[0].body);
  assert.equal(payload.api_key, "test-lawoss-key");
  assert.equal(payload.batch.length, 1);
  assert.equal(payload.batch[0].properties.repo, "Omni-Legal-Products/lawoss");
  assert.equal(payload.batch[0].properties.arch, "x64");
  assert.equal(payload.batch[0].properties.cumulative_downloads, 7);
  assert.ok(
    requests
      .filter(({ method }) => method === "GET")
      .every(({ url }) =>
        url.startsWith(
          "https://api.github.com/repos/Omni-Legal-Products/lawoss/",
        ),
      ),
  );
});

test("dry run never sends snapshots even with explicit LAWOSS configuration", () => {
  const { requests, stdout } = runStats(
    {
      LAWOSS_POSTHOG_KEY: "test-lawoss-key",
      LAWOSS_POSTHOG_HOST: "https://lawoss.invalid",
    },
    ["--dry-run"],
  );
  assert.equal(requests.filter(({ method }) => method === "POST").length, 0);
  assert.match(stdout, /nothing sent/);
});
