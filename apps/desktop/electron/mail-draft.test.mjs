import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { APPLE_MAIL_DRAFT_SCRIPT, OUTLOOK_DRAFT_SCRIPT, WINDOWS_OUTLOOK_DRAFT_SCRIPT, composeAppleMailDraft, composeOutlookDraft } from "./mail-draft.mjs";

const draft = {
  subject: 'Review "quoted" text', body: 'Grüße\n\nLiteral text: "); mail.send(message); //', from: "",
  to: ["review@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"],
  attachments: [{ name: "notes.txt", data: new Uint8Array([0, 10, 255]) }],
};

for (const { name, compose, platform } of [{ name: "Apple Mail", compose: composeAppleMailDraft, platform: "darwin" }, { name: "Outlook Mac", compose: composeOutlookDraft, platform: "darwin" }, { name: "Outlook Windows", compose: composeOutlookDraft, platform: "win32" }]) {
test(`${name} handoff preserves fields and duplicate filenames in private copies, then removes them`, async () => {
  let files = [];
  await compose({ ...draft, attachments: [...draft.attachments, ...draft.attachments] }, {
    platform,
    runScript: async raw => {
      const input = JSON.parse(raw);
      assert.equal(input.subject, draft.subject);
      assert.equal(input.body, draft.body);
      assert.deepEqual([input.to, input.cc, input.bcc], [draft.to, draft.cc, draft.bcc]);
      files = input.attachments;
      assert.notEqual(files[0], files[1]);
      for (const file of files) {
        assert.deepEqual(new Uint8Array(await readFile(file)), draft.attachments[0].data);
        if (process.platform !== "win32") {
          assert.equal((await stat(file)).mode & 0o777, 0o600);
          assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
        }
      }
    },
  });
  for (const file of files) await assert.rejects(stat(file), { code: "ENOENT" });
});

test(`${name} failed handoffs clean up private attachment copies`, async () => {
  let file;
  await assert.rejects(compose(draft, { platform, runScript: async raw => {
    file = JSON.parse(raw).attachments[0];
    throw new Error("Permission denied");
  } }), /Permission denied/);
  await assert.rejects(stat(file), { code: "ENOENT" });
});

test(`${name} rejects path escapes, header injection, oversized payloads and unsupported platforms before launch`, async () => {
  const options = { platform, runScript: async () => assert.fail("must not launch Mail") };
  for (const name of ["../secret", "/secret", "..", "bad\\name", "bad\0name"]) {
    await assert.rejects(compose({ ...draft, attachments: [{ ...draft.attachments[0], name }] }, options));
  }
  await assert.rejects(compose({ ...draft, subject: "Subject\nBcc: injected@example.com" }, options));
  await assert.rejects(compose({ ...draft, attachments: [{ name: "large", data: new Uint8Array(20 * 1024 * 1024 + 1) }] }, options), /20 MB/);
  await assert.rejects(compose(draft, { ...options, platform: "linux" }), /macOS.*only/);
});

}

test("the fixed Mail program saves a visible compose draft and treats message content only as data", () => {
  const message = { toRecipients: [], ccRecipients: [], bccRecipients: [], content: { attachments: [] }, visible: false };
  let saved = false, activated = false;
  const payload = { ...draft, attachments: ["/private/tmp/notes.txt"] };
  const mail = {
    OutgoingMessage: fields => { assert.equal(fields.visible, true); assert.equal(fields.content, draft.body); assert.equal(fields.subject, draft.subject); return message; },
    outgoingMessages: [], ToRecipient: value => value, CcRecipient: value => value, BccRecipient: value => value, Attachment: value => value,
    save: value => { assert.equal(value, message); saved = true; message.visible = false; },
    activate: () => { activated = true; },
    send: () => assert.fail("must never send"),
  };
  runInNewContext(APPLE_MAIL_DRAFT_SCRIPT + "\nrun();", {
    ObjC: { import() {}, unwrap: value => value },
    $: { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: JSON.stringify(payload) } }, NSString: { alloc: { initWithDataEncoding: value => value } } },
    Application: id => { assert.equal(id, "com.apple.mail"); return mail; }, Path: value => value,
  });
  assert.equal(saved, true); assert.equal(activated, true); assert.equal(message.visible, true);
  assert.equal(message.toRecipients[0].address, draft.to[0]);
  assert.equal(message.ccRecipients[0].address, draft.cc[0]);
  assert.equal(message.bccRecipients[0].address, draft.bcc[0]);
  assert.equal(message.content.attachments[0].fileName, payload.attachments[0]);
});


test("Outlook creates an editable persisted draft with recipients and attachments, never sending", () => {
  const message = { toRecipients: [], ccRecipients: [], bccRecipients: [], attachments: [], sender: null, make() { calls.push("make"); return this; } };
  const calls = [];
  const payload = { ...draft, from: "sender@example.com", applicationPath: "/Applications/Microsoft Outlook.app", attachments: ["/private/tmp/notes.txt"] };
  const outlook = {
    OutgoingMessage: fields => { assert.equal(fields.plainTextContent, draft.body); assert.equal(fields.subject, draft.subject); return message; },
    outgoingMessages: [], ToRecipient: value => value, CcRecipient: value => value, BccRecipient: value => value, Attachment: value => value,
    save: value => { assert.equal(value, message); calls.push("save"); },
    open: value => { assert.equal(value, message); calls.push("open"); },
    activate: () => calls.push("activate"),
    send: () => assert.fail("must never send"),
  };
  const context = {
    ObjC: { import() {}, unwrap: value => value },
    $: { NSFileHandle: { fileHandleWithStandardInput: { readDataToEndOfFile: JSON.stringify(payload) } }, NSString: { alloc: { initWithDataEncoding: value => value } } },
    Application: id => { assert.equal(id, payload.applicationPath); return outlook; }, Path: value => value,
  };
  runInNewContext(OUTLOOK_DRAFT_SCRIPT + "\nrun();", context);
  assert.deepEqual(calls, ["make", "open", "activate"]);
  assert.equal(message.sender, null); // Outlook selects its own sending account.
  assert.equal(message.toRecipients[0].emailAddress.address, draft.to[0]);
  assert.equal(message.ccRecipients[0].emailAddress.address, draft.cc[0]);
  assert.equal(message.bccRecipients[0].emailAddress.address, draft.bcc[0]);
  assert.equal(message.attachments[0].file, payload.attachments[0]);

  // Do not report a successful handoff if Outlook silently ignores an attachment.
  calls.length = 0;
  message.attachments.length = 0;
  message.attachments.push = () => 0;
  assert.throws(() => runInNewContext(OUTLOOK_DRAFT_SCRIPT + "\nrun();", context), /did not import every attachment/);
  assert.deepEqual(calls, ["make"]);
});

test("Windows rejects device names and alternate data streams before staging", async () => {
  for (const name of ["notes:stream", "CON.txt", "nul", "COM1.txt", "LPT²", "a?b.txt", "trailing.", "space "]) {
    await assert.rejects(composeOutlookDraft({ ...draft, attachments: [{ ...draft.attachments[0], name }] }, { platform: "win32", runScript: async () => assert.fail("must not launch") }), /filename/);
  }
});

test("Windows PowerShell passes literal Unicode and imports attachments into a saved compose item", { skip: process.platform !== "win32" }, async () => {
  // Run the production PowerShell program in Windows with a COM test double.
  // CI does not have a configured Outlook account and must never send mail.
  const harness = `
$global:calls = [System.Collections.Generic.List[string]]::new()
$global:message = [pscustomobject]@{ Subject = ''; BodyFormat = 0; Body = ''; Recipients = [System.Collections.Generic.List[object]]::new(); Attachments = [System.Collections.Generic.List[string]]::new() }
$recipients = [pscustomobject]@{ Items = $global:message.Recipients }
$recipients | Add-Member ScriptMethod Add { param($address) $r = [pscustomobject]@{ Address = $address; Type = 0 }; $this.Items.Add($r); return $r }
$attachments = [pscustomobject]@{ Items = $global:message.Attachments }
$attachments | Add-Member ScriptMethod Add { param($file, $type) if ($type -ne 1) { throw 'Expected by-value attachment' }; $this.Items.Add($file); $global:calls.Add('attach') }
$attachments | Add-Member ScriptProperty Count { return $this.Items.Count }
$global:message.Recipients = $recipients
$global:message.Attachments = $attachments
$global:message | Add-Member ScriptMethod Save { $global:calls.Add('save') }
$global:message | Add-Member ScriptMethod Display { param($modal) if ($modal) { throw 'Unexpected modal' }; $global:calls.Add('display') }
$global:message | Add-Member ScriptMethod Send { throw 'Must never send' }
function New-Object { param($ComObject) if ($ComObject -ne 'Outlook.Application') { throw 'Unexpected COM class' }; $app = [pscustomobject]@{}; $app | Add-Member ScriptMethod CreateItem { param($type) if ($type -ne 0) { throw 'Expected mail item' }; return $global:message }; return $app }
`;
  const payload = { ...draft, attachments: ["C:\\Users\\Test\\Grüße notes.txt"] };
  const result = await new Promise((resolve, reject) => {
    const script = harness + WINDOWS_OUTLOOK_DRAFT_SCRIPT + '\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n@{ subject = $message.Subject; body = $message.Body; recipients = @($message.Recipients.Items); attachments = @($message.Attachments.Items); calls = @($calls) } | ConvertTo-Json -Depth 5';
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 30000 }, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(JSON.parse(stdout)));
    child.stdin.end(JSON.stringify(payload));
  });
  assert.equal(result.subject, draft.subject);
  assert.equal(result.body, draft.body);
  assert.deepEqual(result.recipients.map(item => [item.Address, item.Type]), [[draft.to[0], 1], [draft.cc[0], 2], [draft.bcc[0], 3]]);
  assert.deepEqual(result.attachments, payload.attachments);
  assert.deepEqual(result.calls, ["save", "attach", "save", "display"]);
});
