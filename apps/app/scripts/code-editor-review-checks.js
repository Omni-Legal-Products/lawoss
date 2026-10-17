async (page) => {
  const base = "http://127.0.0.1:5185/workspace/code-editor-review/files/content";
  const headers = { Authorization: "Bearer code-editor-review-client" };
  const read = async name => {
    const response = await page.request.get(`${base}?path=${encodeURIComponent(name)}`, { headers });
    if (!response.ok()) throw new Error(`Read failed: ${response.status()}`);
    return await response.json();
  };
  const until = async check => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await check()) return;
      await page.waitForTimeout(100);
    }
    throw new Error("Expected saved state did not arrive");
  };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const tab = name => page.getByRole("button", { name: `Select tab: ${name}`, exact: true }).click();
  const autosave = page.getByRole("switch", { name: "Autosave", exact: true });
  const results = [];
  const external = [];
  await page.route("**/*", async route => {
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(route.request().url())) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });

  await tab("Notes.md");
  assert(await autosave.isChecked(), "Markdown autosave should default on");
  const markdown = page.getByRole("textbox", { name: "editable markdown" });
  await markdown.press("ControlOrMeta+End");
  await markdown.press("Enter");
  await markdown.pressSequentially("Saved automatically from the Markdown editor.");
  await until(async () => (await read("Notes.md")).content.includes("Saved automatically from the Markdown editor."));
  results.push("Markdown autosave defaults on and writes to the real file API");

  await tab("Plain.txt");
  const text = page.getByRole("textbox", { name: "Edit Plain.txt" });
  await text.waitFor();
  assert(await autosave.isChecked(), "Text autosave should default on");
  let observed;
  const started = new Promise(resolve => { observed = resolve; });
  let slow = true;
  await page.route(base, async route => {
    if (route.request().method() === "POST" && slow) {
      slow = false;
      observed();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    await route.continue();
  });
  await text.fill("First snapshot.\n");
  await started;
  await text.fill("Second snapshot typed during the in-flight save.\n");
  await until(async () => (await read("Plain.txt")).content === "Second snapshot typed during the in-flight save.\n");
  assert((await text.innerText()).includes("Second snapshot"), "Save acknowledgement overwrote the live draft");
  await page.unroute(base);
  results.push("Text autosave preserves and subsequently saves edits typed during an in-flight write");

  await autosave.uncheck();
  await text.fill("Opt-out draft remains local.\n");
  await page.waitForTimeout(1900);
  assert(!(await read("Plain.txt")).content.includes("Opt-out"), "Disabled autosave wrote the draft");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await until(async () => (await read("Plain.txt")).content.includes("Opt-out"));
  await page.reload();
  await text.waitFor();
  assert(!await autosave.isChecked(), "Text autosave opt-out was not remembered");
  await autosave.check();
  results.push("Per-file opt-out survives reload and manual save still works");

  const baseline = await read("Plain.txt");
  const remote = await page.request.post(base, { headers, data: { path: "Plain.txt", content: "Concurrent edit on disk.\n", baseUpdatedAt: baseline.updatedAt, baseContent: baseline.content } });
  assert(remote.ok(), "Could not create concurrent disk edit");
  let writes = 0;
  const countWrites = request => { if (request.url() === base && request.method() === "POST") writes++; };
  page.on("request", countWrites);
  await text.fill("Conflicting local edit retained.\n");
  await page.getByText("Autosave paused", { exact: true }).waitFor();
  await page.waitForTimeout(1900);
  assert(writes === 1, "Autosave retried a conflict without user action");
  assert((await read("Plain.txt")).content === "Concurrent edit on disk.\n", "Conflict overwrote concurrent disk changes");
  assert((await text.innerText()).includes("Conflicting local edit"), "Conflict lost the draft");
  page.off("request", countWrites);
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  results.push("Conflicts retain the text draft and disk content, and pause automatic retries");

  await tab("config.json");
  const json = page.getByRole("textbox", { name: "Edit config.json" });
  await json.fill('{\n  "name": "LegalWork",\n  "enabled":\n}\n');
  await page.getByRole("button", { name: /syntax issue/ }).waitFor();
  await page.getByRole("button", { name: /syntax issue/ }).click();
  await json.fill('{\n  "name": "LegalWork",\n  "enabled": true\n}\n');
  await page.getByRole("button", { name: "No syntax errors", exact: true }).waitFor();
  await until(async () => (await read("config.json")).content.includes('"enabled": true'));
  results.push("JSON inline diagnostics clear after correction and code autosaves");

  await tab("review.py");
  await page.getByRole("textbox", { name: "Edit review.py" }).waitFor();
  await page.getByRole("button", { name: "No syntax errors", exact: true }).waitFor();
  await tab("matter.ts");
  await page.getByRole("textbox", { name: "Edit matter.ts" }).waitFor();
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.getByRole("button", { name: "Light theme", exact: true }).click();
  assert(external.length === 0, `Editor requested external resources: ${external.join(", ")}`);
  results.push("Python and TypeScript render in light/dark themes without external resource requests");
  return results;
}
