// Run through playwright-cli run-code --filename after starting the app's Vite server.
// The current page must use that loopback server; all document data is synthetic.
async (page) => {
  const origin = new URL(page.url()).origin;
  const source = { id: "synthetic-source", path: "source.pdf", workspaceId: "synthetic", hash: "a".repeat(64), status: "partial", complete: false, pageCount: 235, readablePages: 8, updatedAt: 1, provenance: { sourcePath: "source.pdf", depth: 0 } };
  let reads = 0, lists = 0, sends = 0, stale = false, releasePoll, pollStarted, pollFinished;
  let started = () => {}, finished = () => {};
  const heldPoll = () => new Promise(resolve => { releasePoll = resolve; });
  const waitForPoll = async () => {
    let timer;
    try { await Promise.race([pollStarted, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Background poll did not start")), 10_000); })]); }
    finally { clearTimeout(timer); }
  };
  await page.route(`${origin}/__document_polling_fixture/**`, async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/outputs")) return route.fulfill({ json: { outputs: [], nextOffset: null, legalApproval: false } });
    if (url.pathname.endsWith("/documents")) {
      // Hold just the background poll. The click's independent preflight can finish.
      const background = ++lists === 2;
      if (background) { const pending = heldPoll(); started(); await pending; }
      try { return await route.fulfill({ json: { documents: [source], nextOffset: null, untrusted: true } }); }
      finally { if (background) finished(); }
    }
    if (url.pathname.endsWith("/read")) {
      reads++;
      return stale
        ? route.fulfill({ status: 409, json: { code: "document_stale", message: "Synthetic source changed" } })
        : route.fulfill({ json: { ...source, text: "Synthetic source", pages: [{ page: 1, text: "Synthetic source", source: "native" }], offset: 0, nextOffset: null, untrusted: true } });
    }
    if (url.pathname.endsWith("/generate")) {
      const request = route.request().postDataJSON();
      if (request.projectId !== "synthetic-project" || request.sources.length !== 1 || request.sources[0].hash !== source.hash) throw new Error("Unexpected generation scope");
      sends++;
      return route.fulfill({ status: 204 });
    }
    throw new Error(`Unexpected synthetic endpoint: ${url.pathname}`);
  });
  try {
    for (const changed of [false, true]) {
      lists = 0; stale = false; releasePoll = undefined;
      pollStarted = new Promise(resolve => { started = resolve; });
      pollFinished = new Promise(resolve => { finished = resolve; });
      const initialReads = reads, initialSends = sends;
      await page.goto(`${origin}/tests/fixtures/document-generation-polling.html`);
      const generate = page.getByRole("button", { name: "Generovat přes chat", exact: true });
      await generate.waitFor();
      await waitForPoll();
      await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === "Ověřování aktuálních zdrojů…", undefined, { timeout: 10_000 });
      if (!releasePoll) throw new Error("Background poll was not reached");
      await page.screenshot({ path: `output/playwright/document-generation-${changed ? "changed" : "polling"}.png` });
      if (!await generate.isEnabled()) throw new Error("Generation is disabled by background verification");
      stale = changed;
      await generate.click();
      if (changed) {
        await page.getByRole("alert").filter({ hasText: "Zdroj se změnil" }).waitFor();
        if (sends !== initialSends) throw new Error("Changed source reached generation");
      } else {
        await page.getByText("Syntetické zadání přijato", { exact: true }).waitFor();
        if (sends !== initialSends + 1) throw new Error("Expected one accepted generation");
      }
      if (reads <= initialReads + 1) throw new Error("Generate did not freshly read its sources");
      releasePoll(); releasePoll = undefined; await pollFinished;
    }
    return { ok: true, scenarios: ["generation during held background poll", "changed source rejected before send"], sends };
  } finally {
    if (releasePoll) { releasePoll(); await pollFinished; }
    await page.unroute(`${origin}/__document_polling_fixture/**`);
  }
}
