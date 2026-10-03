// Real MDXEditor browser regression; no model/server or disk writes.
// Serve apps/app with its Vite config, open /tests/fixtures/markdown-clean-open.html
// in a separate Playwright CLI session, then run-code with this file's contents.
async (page) => {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+\/tests\/fixtures\/markdown-clean-open\.html(?:\?|$)/.test(page.url())) {
    throw Error("Open the synthetic fixture in a separate Playwright session before running this regression");
  }
  const origin = page.url().split("/").slice(0, 3).join("/");
  const results = [];
  const knownLimitations = [];
  // Only this isolated fixture page is navigated between independent scenarios.
  page.removeAllListeners("dialog");
  page.on("dialog", dialog => dialog.type() === "beforeunload" ? dialog.accept() : dialog.dismiss());
  const snapshot = () => page.evaluate(() => window.markdownCleanOpen.snapshot());
  const check = (condition, name) => { if (!condition) throw Error(name); results.push(name); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const open = async (panel = false, readOnly = false) => {
    const query = [panel && "panel", readOnly && "readonly"].filter(Boolean).join("&");
    await page.goto(`${origin}/tests/fixtures/markdown-clean-open.html${query ? `?${query}` : ""}`);
    await page.getByRole("textbox", { name: "upravitelné označení" }).waitFor();
    await settle();
  };

  await open();
  let state = await snapshot();
  check(!state.dirty && state.value === state.original && state.changes.length === 0, "opening bare URLs/email retains exact source bytes without changes");
  check(await page.locator('.lw-markdown-page a[href="https://example.org/explicit"]').count() === 1, "explicit Markdown links still render");
  await page.getByRole("textbox", { name: "upravitelné označení" }).click();
  await page.getByRole("radio", { name: "Zdrojový režim" }).click();
  await page.getByRole("radio", { name: "Bohatý text", exact: true }).click();
  await page.getByRole("button", { name: "Vytvořit odkaz", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.evaluate(() => window.markdownCleanOpen.refresh());
  await settle();
  state = await snapshot();
  check(!state.dirty && state.value === state.original && state.changes.length === 0, "focus, toolbar Tab navigation, source/rich switching and prop refresh remain clean");

  await page.getByRole("textbox", { name: "upravitelné označení" }).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("Actual user edit");
  await settle();
  state = await snapshot();
  check(state.dirty && state.value.includes("Actual user edit"), "real rich-text editing is dirty and retained");
  // History steps are per typed character; undo back to the untouched document (#90).
  let undos = 0;
  while (undos < 40 && state.dirty) {
    await page.getByRole("radio", { name: /Vrátit zpět/ }).click();
    await settle();
    state = await snapshot();
    undos++;
  }
  check(!state.value.includes("Actual user edit"), "undo removes the real user edit");
  check(!state.dirty && state.value === state.original, "undo back to the original restores exact source bytes and a clean state (#90)");
  for (let i = 0; i < undos; i++) {
    await page.getByRole("radio", { name: /Znovu/ }).click();
    await settle();
  }
  state = await snapshot();
  check(state.dirty && state.value.includes("Actual user edit"), "redo restores the edit and dirty protection");
  await page.evaluate(() => window.markdownCleanOpen.save());
  await settle();
  check(!(await snapshot()).dirty, "save baseline update keeps the current edit clean");

  await open();
  await page.getByRole("textbox", { name: "upravitelné označení" }).click();
  await page.getByRole("button", { name: "Vytvořit odkaz", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("https://example.org/created");
  await page.getByRole("textbox", { name: "Kotva text", exact: true }).fill("Created test link");
  await page.getByRole("button", { name: "Nastavit URL", exact: true }).click();
  await settle();
  state = await snapshot();
  check(state.dirty && state.value.includes("[Created test link](https://example.org/created)"), "CreateLink still inserts an explicit user-authored Markdown link");

  await open();
  await page.getByRole("radio", { name: "Zdrojový režim" }).click();
  const original = (await snapshot()).original;
  await page.locator(".cm-content[contenteditable=true]").fill(original.slice(0, -1));
  await settle();
  state = await snapshot();
  check(state.dirty && state.value === original.slice(0, -1), "intentional source whitespace edits remain exact and dirty");
  await page.locator(".cm-content[contenteditable=true]").fill(original);
  await settle();
  state = await snapshot();
  check(!state.dirty && state.value === original, "source restoration of exact original bytes returns clean");

  await open(false, true);
  check(await page.getByRole("textbox", { name: "upravitelné označení" }).getAttribute("contenteditable") === "false", "read-only Markdown does not expose an editable rich-text surface");
  await page.getByRole("textbox", { name: "upravitelné označení" }).click();
  await page.keyboard.type("Forbidden read-only edit");
  await settle();
  state = await snapshot();
  check(!state.dirty && state.value === state.original && state.changes.length === 0, "read-only open/focus/typing cannot alter the original bytes");

  await open(true);
  state = await snapshot();
  check(!state.dirty && state.writes === 0 && state.disk === state.original, "full panel opens clean without writes");
  await page.evaluate(() => window.markdownCleanOpen.refetch());
  await page.evaluate(() => window.markdownCleanOpen.focus());
  await settle();
  state = await snapshot();
  check(!state.dirty && state.reads >= 2 && state.writes === 0 && state.disk === state.original, "query refetch/window focus keep panel clean and original bytes exact");
  await page.evaluate(() => window.markdownCleanOpen.replaceDisk(window.markdownCleanOpen.snapshot().original.replace("Test www.example.org", "External update www.example.org")));
  await settle();
  state = await snapshot();
  check(!state.dirty && state.writes === 0 && (await page.getByRole("textbox", { name: "upravitelné označení" }).innerText()).includes("External update"), "clean external refetch imports new disk bytes without false dirty");
  await page.getByRole("radio", { name: "Zdrojový režim" }).click();
  await page.locator(".cm-content[contenteditable=true]").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\nSource edit");
  await settle();
  check((await snapshot()).dirty, "source edits are dirty");
  await page.evaluate(() => window.markdownCleanOpen.refetch());
  await settle();
  check((await snapshot()).dirty && (await page.locator(".cm-content").innerText()).includes("Source edit"), "refetch cannot discard a source edit");
  await page.getByRole("button", { name: "Uložit", exact: true }).click();
  await page.waitForFunction(() => window.markdownCleanOpen.snapshot().writes === 1);
  await settle();
  state = await snapshot();
  check(!state.dirty && state.writes === 1 && state.disk.includes("Source edit"), "source save persists the user edit and advances baseline");
  // A stale pristine mapping misses the new baseline or restores old source bytes.
  // Each case keeps the real panel/editor mounted across the baseline transition.
  const editAndUndo = async (label) => {
    const box = page.getByRole("textbox", { name: "upravitelné označení" });
    await box.click();
    await box.press("End");
    await page.keyboard.type("X");
    await settle();
    check((await snapshot()).dirty, `${label}: a real edit is dirty`);
    await page.getByRole("radio", { name: /Vrátit zpět/ }).click();
    await settle();
    check(!(await snapshot()).dirty, `${label}: Undo restores exact current baseline`);
  };
  for (const transition of ["refetch", "save", "conflict"]) {
    await open(true);
    const next = (await snapshot()).original.replace("Test www.example.org", `${transition} www.example.org`);
    if (transition === "refetch") {
      await page.evaluate(next => window.markdownCleanOpen.replaceDisk(next), next);
    } else {
      await page.getByRole("radio", { name: "Zdrojový režim" }).click();
      await page.locator(".cm-content[contenteditable=true]").fill(next);
      await settle();
      if (transition === "conflict") {
        await page.evaluate(next => window.markdownCleanOpen.replaceDisk(next, false), next.replace("conflict www", "External conflict www"));
      }
      await page.getByRole("button", { name: "Uložit", exact: true }).click();
      if (transition === "conflict") {
        await page.getByRole("button", { name: "Použijte jinou verzi", exact: true }).click();
      } else {
        await page.waitForFunction(() => window.markdownCleanOpen.snapshot().writes === 1);
      }
      await page.getByRole("radio", { name: "Bohatý text", exact: true }).click();
    }
    await settle();
    check(!(await snapshot()).dirty, `${transition}: new baseline starts clean`);
    await editAndUndo(transition);
  }
  for (const syntax of ["bullet", "canonical"]) {
    await open();
    await page.getByRole("radio", { name: "Zdrojový režim" }).click();
    const originalSource = (await snapshot()).original;
    const intentional = syntax === "bullet"
      ? originalSource.replace("* original bullet", "- original bullet")
      : originalSource.replace("[reference]", "\\[reference]").trim();
    // Make a real source edit before returning to a spelling already displayed by MDXEditor.
    await page.locator(".cm-content[contenteditable=true]").fill(intentional + "\nTemporary edit");
    await settle();
    await page.locator(".cm-content[contenteditable=true]").fill(intentional);
    await settle();
    await page.getByRole("radio", { name: "Bohatý text", exact: true }).click();
    await page.getByRole("textbox", { name: "upravitelné označení" }).click();
    await page.keyboard.type("X");
    await settle();
    await page.getByRole("radio", { name: /Vrátit zpět/ }).click();
    await settle();
    state = await snapshot();
    check(state.dirty && state.value === intentional, `rich-text Undo preserves an intentional ${syntax} source edit`);
  }

  await open();
  const whitespaceBaseline = (await snapshot()).original + "\n";
  await page.evaluate(next => window.markdownCleanOpen.replace(next), whitespaceBaseline);
  await settle();
  await editAndUndo("whitespace-only baseline");
  check((await snapshot()).value === whitespaceBaseline, "whitespace-only import restores exact bytes");
  return { checks: results.length, results, knownLimitations };
}
