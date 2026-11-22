import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, chmod, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { CHEVRON7_REQUIREMENT, chevron7Session, createChevron7Cli, findChevron7Helper, resolveClientPdf, runChevron7Cli } from "./lawoss-chevron7-cli.mjs";

const exec = promisify(execFile);

const envelope = (result) => JSON.stringify({ apiVersion: 1, requestId: "SYN", ok: true, result });
const failure = (code) => JSON.stringify({ apiVersion: 1, requestId: "SYN", ok: false, error: { code, message: "SYN", retryable: false } });
const unsigned = { validationState: "unsigned", validationPerformed: false, signatureCount: 0, unverifiedDocumentCount: 0, tree: { signatures: [], documents: [] } };

async function withClient(fn) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-cli-syn-")));
  const client = path.join(dir, "klient");
  await mkdir(path.join(client, "upravy"), { recursive: true });
  const pdf = path.join(client, "upravy", "SYN zmluva.pdf");
  await writeFile(pdf, "%PDF-1.4\n%%EOF");
  try { await fn({ dir, client, pdf }); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("session name is per client root, stable, and carries no folder name", () => {
  const a = chevron7Session("/Users/syn/Klienti/Novak s.r.o.");
  assert.match(a, /^lawoss-[0-9a-f]{24}$/);
  assert.equal(chevron7Session("/Users/syn/Klienti/Novak s.r.o."), a);
  assert.notEqual(chevron7Session("/Users/syn/Klienti/Iny"), a);
  assert.equal(a.includes("Novak"), false);
});

test("only an absolute PDF inside the client root is admitted, also after resolving links", async () => {
  await withClient(async ({ dir, client, pdf }) => {
    assert.deepEqual(await resolveClientPdf(pdf, client), { file: pdf, root: client });
    assert.equal(await resolveClientPdf("upravy/SYN zmluva.pdf", client), null);
    assert.equal(await resolveClientPdf(path.join(client, "upravy"), client), null);
    const outside = path.join(dir, "mimo.pdf");
    await writeFile(outside, "%PDF-1.4\n%%EOF");
    assert.equal(await resolveClientPdf(outside, client), null);
    if (process.platform !== "win32") {
      // Symlinks need extra rights on Windows; the module is macOS-only in practice.
      const link = path.join(client, "odkaz.pdf");
      await symlink(outside, link);
      assert.equal(await resolveClientPdf(link, client), null);
    }
    const disguised = path.join(client, "nie-pdf.pdf");
    await writeFile(disguised, "not a pdf");
    assert.equal(await resolveClientPdf(disguised, client), null);
    assert.equal(await resolveClientPdf(pdf, path.join(dir, "neexistuje")), null);
    // A sibling folder sharing the prefix is not inside the root.
    await mkdir(`${client}2`);
    const sibling = path.join(`${client}2`, "SYN.pdf");
    await writeFile(sibling, "%PDF-1.4\n%%EOF");
    assert.equal(await resolveClientPdf(sibling, client), null);
  });
});

test("helper is found only as an executable regular file inside the bundle", async () => {
  if (process.platform === "win32") return;
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-cli-syn-")));
  const bundle = path.join(dir, "Chevron7.app");
  const helpers = path.join(bundle, "Contents", "Helpers");
  await mkdir(helpers, { recursive: true });
  const helper = path.join(helpers, "chevron7");
  try {
    assert.equal(await findChevron7Helper(bundle), null);
    await writeFile(helper, "#!/bin/sh\n");
    assert.equal(await findChevron7Helper(bundle), null);
    await chmod(helper, 0o755);
    assert.equal(await findChevron7Helper(bundle), helper);
    await rm(helper);
    const elsewhere = path.join(dir, "chevron7");
    await writeFile(elsewhere, "#!/bin/sh\n");
    await chmod(elsewhere, 0o755);
    await symlink(elsewhere, helper);
    assert.equal(await findChevron7Helper(bundle), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("runner passes literal argv, no inherited secret, bounds output and stops on timeout", async () => {
  if (process.platform === "win32") return;
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-cli-syn-")));
  const helper = path.join(dir, "fake-chevron7");
  process.env.LAWOSS_SYN_SECRET = "do-not-inherit";
  try {
    await writeFile(helper, [
      "#!/bin/bash",
      '[[ "$1" == "--session" && "$2" == "lawoss-abc" && "$3" == "inspect" && "$4" == \'/tmp/SYN $(false).pdf\' ]] || exit 2',
      '[[ "$5" == "--root" && "$6" == "/tmp" && "$7" == "--json" ]] || exit 2',
      '[[ -z "$LAWOSS_SYN_SECRET" ]] || exit 3',
      "echo 'identity data' >&2",
      `printf '%s' '${envelope(unsigned)}'`,
    ].join("\n"));
    await chmod(helper, 0o755);
    const ok = await runChevron7Cli(helper, ["--session", "lawoss-abc", "inspect", "/tmp/SYN $(false).pdf", "--root", "/tmp", "--json"]);
    assert.equal(ok.code, 0);
    assert.equal(ok.envelope?.ok, true);
    assert.equal(JSON.stringify(ok).includes("identity data"), false);

    await writeFile(helper, "#!/bin/bash\nhead -c 70000 /dev/zero | tr '\\0' 'x'\n");
    assert.deepEqual(await runChevron7Cli(helper, [], { maxOutput: 65536 }), { code: null, envelope: null, reason: "output-limit" });

    await writeFile(helper, "#!/bin/bash\nsleep 60\n");
    assert.deepEqual(await runChevron7Cli(helper, [], { timeout: 50 }), { code: null, envelope: null, reason: "timeout" });

    await writeFile(helper, "#!/bin/bash\necho '{\"apiVersion\":2,\"ok\":true}'\n");
    assert.deepEqual(await runChevron7Cli(helper, []), { code: 0, envelope: null, reason: "incompatible" });
  } finally { delete process.env.LAWOSS_SYN_SECRET; await rm(dir, { recursive: true, force: true }); }
});

function cliWith(responses, calls = []) {
  return createChevron7Cli({ platform: "darwin", roots: [] }, {
    find: async () => ({ bundle: "/test/Chevron7.app", helper: "/test/Chevron7.app/Contents/Helpers/chevron7" }),
    verify: async (bundle) => { calls.push(["verify", bundle]); },
    run: async (helper, args) => { calls.push(["run", helper, args]); return responses.shift(); },
  });
}

test("inspect sends session, file and client root; unsigned only when nothing is signed", async () => {
  await withClient(async ({ client, pdf }) => {
    const calls = [];
    const cli = cliWith([
      { code: 0, envelope: JSON.parse(envelope(unsigned)) },
      { code: 0, envelope: JSON.parse(envelope({ ...unsigned, validationState: "notValidated", signatureCount: 1 })) },
      { code: 0, envelope: JSON.parse(envelope({ ...unsigned, validationState: "notValidated", unverifiedDocumentCount: 1 })) },
      { code: 0, envelope: JSON.parse(envelope({ validationState: "unsigned" })) },
    ], calls);
    assert.deepEqual(await cli.inspect(pdf, client), { status: "unsigned" });
    assert.deepEqual(calls[0], ["verify", "/test/Chevron7.app"]);
    assert.deepEqual(calls[1], ["run", "/test/Chevron7.app/Contents/Helpers/chevron7",
      ["--session", chevron7Session(client), "inspect", pdf, "--root", client, "--json"]]);
    assert.deepEqual(await cli.inspect(pdf, client), { status: "signed", signatureCount: 1, unverifiedDocumentCount: 0 });
    assert.deepEqual(await cli.inspect(pdf, client), { status: "signed", signatureCount: 0, unverifiedDocumentCount: 1 });
    assert.deepEqual(await cli.inspect(pdf, client), { status: "failed" });
  });
});

test("exit codes and refused requests map to typed outcomes, never to unsigned", async () => {
  await withClient(async ({ client, pdf }) => {
    const cases = [
      [{ code: 3, envelope: JSON.parse(failure("APP_UNAVAILABLE")) }, { status: "unavailable" }],
      [{ code: 4, envelope: JSON.parse(failure("BUSY")) }, { status: "busy" }],
      [{ code: 7, envelope: JSON.parse(failure("FILE_ACCESS")) }, { status: "file-error" }],
      [{ code: 2, envelope: JSON.parse(failure("INVALID_ARGUMENTS")) }, { status: "refused" }],
      [{ code: 8, envelope: JSON.parse(failure("INSPECTION_FAILED")) }, { status: "failed" }],
      [{ code: null, envelope: null, reason: "timeout" }, { status: "timeout" }],
      [{ code: 0, envelope: null, reason: "incompatible" }, { status: "failed" }],
      [{ code: 0, envelope: JSON.parse(failure("SOMETHING")) }, { status: "failed" }],
    ];
    for (const [response, expected] of cases) {
      assert.deepEqual(await cliWith([response]).inspect(pdf, client), expected);
    }
  });
});

test("validate reports the state; exit 10 is a completed validation, not a call failure", async () => {
  await withClient(async ({ client, pdf }) => {
    const valid = { ...unsigned, validationState: "valid", validationPerformed: true, signatureCount: 1 };
    const cli = cliWith([
      { code: 0, envelope: JSON.parse(envelope(valid)) },
      { code: 10, envelope: JSON.parse(envelope({ ...valid, validationState: "indeterminate" })) },
      { code: 10, envelope: JSON.parse(envelope({ ...valid, validationState: "unsigned", signatureCount: 0 })) },
      { code: 0, envelope: JSON.parse(envelope({ ...valid, validationState: "indeterminate" })) },
    ]);
    assert.deepEqual(await cli.validate(pdf, client), { status: "validated", validationState: "valid", fullyValid: true, signatureCount: 1 });
    assert.deepEqual(await cli.validate(pdf, client), { status: "validated", validationState: "indeterminate", fullyValid: false, signatureCount: 1 });
    assert.deepEqual(await cli.validate(pdf, client), { status: "validated", validationState: "unsigned", fullyValid: false, signatureCount: 0 });
    // Exit 0 must agree with the reported state; a disagreement is not trusted as valid.
    assert.deepEqual(await cli.validate(pdf, client), { status: "failed" });
  });
});

test("refuses files outside the client, unverified bundles, missing helper, and concurrent calls", async () => {
  await withClient(async ({ dir, client, pdf }) => {
    const outside = path.join(dir, "mimo.pdf");
    await writeFile(outside, "%PDF-1.4\n%%EOF");
    let ran = false;
    const run = async () => { ran = true; return { code: 0, envelope: JSON.parse(envelope(unsigned)) }; };
    const cli = createChevron7Cli({}, { find: async () => ({ bundle: "b", helper: "h" }), verify: async () => {}, run });
    assert.deepEqual(await cli.inspect(outside, client), { status: "invalid-file" });
    assert.equal(ran, false);

    const unverified = createChevron7Cli({}, { find: async () => ({ bundle: "b", helper: "h" }), verify: async () => { throw Error("bad signature"); }, run });
    assert.deepEqual(await unverified.inspect(pdf, client), { status: "unavailable" });
    assert.equal(ran, false);

    const missing = createChevron7Cli({}, { find: async () => null, verify: async () => {}, run });
    assert.deepEqual(await missing.inspect(pdf, client), { status: "unavailable" });

    let release = () => {};
    const slow = createChevron7Cli({}, {
      find: async () => ({ bundle: "b", helper: "h" }), verify: async () => {},
      run: () => new Promise(resolve => { release = () => resolve({ code: 0, envelope: JSON.parse(envelope(unsigned)) }); }),
    });
    const first = slow.inspect(pdf, client);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(await slow.inspect(pdf, client), { status: "busy" });
    release();
    assert.deepEqual(await first, { status: "unsigned" });
    slow.dispose();
    assert.deepEqual(await slow.inspect(pdf, client), { status: "unavailable" });
  });
});

test("unsupported platform never probes installed apps", async () => {
  const cli = createChevron7Cli({ platform: "linux", roots: ["/Applications"] });
  assert.deepEqual(await cli.inspect("/tmp/SYN.pdf", "/tmp"), { status: "unavailable" });
});

test("designated requirement rejects an ad-hoc bundle that only copies the Chevron7 bundle id", { skip: process.platform !== "darwin" }, async () => {
  assert.match(CHEVRON7_REQUIREMENT, /identifier "app\.slovensko\.chevron7"/);
  assert.match(CHEVRON7_REQUIREMENT, /certificate leaf\[subject\.OU\] = "Q7AU96CW7H"/);
  const dir = await mkdtemp(path.join(tmpdir(), "lawoss-chevron7-req-"));
  try {
    const bundle = path.join(dir, "Chevron7.app");
    await mkdir(path.join(bundle, "Contents", "MacOS"), { recursive: true });
    await writeFile(path.join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>app.slovensko.chevron7</string><key>CFBundleExecutable</key><string>Chevron7</string></dict></plist>`);
    await copyFile("/bin/echo", path.join(bundle, "Contents", "MacOS", "Chevron7"));
    await exec("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", "app.slovensko.chevron7", bundle]);
    await exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
    await assert.rejects(exec("/usr/bin/codesign", ["--verify", "--deep", "--strict", "-R", CHEVRON7_REQUIREMENT, bundle]));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
