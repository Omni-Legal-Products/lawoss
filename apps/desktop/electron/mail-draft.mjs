import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";

const header = z.string().max(2000).refine(value => !/[\r\n\0]/.test(value));
const draftSchema = z.object({
  subject: header, body: z.string().max(500000), from: header,
  to: z.array(header).max(2000), cc: z.array(header).max(2000), bcc: z.array(header).max(2000),
  attachments: z.array(z.object({
    name: z.string().min(1).max(255).refine(value => !/[\\/\r\n\0]/.test(value) && value !== "." && value !== ".."),
    data: z.instanceof(Uint8Array),
  })).max(20),
});

// A fixed program, with all user content delivered as JSON on stdin. Never
// interpolate a subject, address, body or filename into executable source.
export const APPLE_MAIL_DRAFT_SCRIPT = `
ObjC.import("Foundation");
function run() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  var mail = Application("com.apple.mail");
  var message = mail.OutgoingMessage({ subject: input.subject, content: input.body, visible: true });
  mail.outgoingMessages.push(message);
  if (input.from) message.sender = input.from;
  input.to.forEach(function(address) { message.toRecipients.push(mail.ToRecipient({ address: address })); });
  input.cc.forEach(function(address) { message.ccRecipients.push(mail.CcRecipient({ address: address })); });
  input.bcc.forEach(function(address) { message.bccRecipients.push(mail.BccRecipient({ address: address })); });
  input.attachments.forEach(function(file) {
    message.content.attachments.push(mail.Attachment({ fileName: Path(file) }));
  });
  mail.save(message);
  message.visible = true;
  mail.activate();
}`;

// Outlook templates can silently omit attachments in modern Outlook for Mac.
// Create an outgoing message and attach each private file explicitly instead.
export const OUTLOOK_DRAFT_SCRIPT = `
ObjC.import("Foundation");
function run() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var input = JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding)));
  var mail = Application(input.applicationPath);
  var message = mail.OutgoingMessage({ subject: input.subject, plainTextContent: input.body });
  message = message.make();
  // Modern Outlook uses its selected account; its sender setter is ignored.
  input.to.forEach(function(address) { message.toRecipients.push(mail.ToRecipient({ emailAddress: { address: address } })); });
  input.cc.forEach(function(address) { message.ccRecipients.push(mail.CcRecipient({ emailAddress: { address: address } })); });
  input.bcc.forEach(function(address) { message.bccRecipients.push(mail.BccRecipient({ emailAddress: { address: address } })); });
  input.attachments.forEach(function(file) { message.attachments.push(mail.Attachment({ file: Path(file) })); });
  if (message.attachments.length !== input.attachments.length) throw new Error("Outlook did not import every attachment.");
  // Outlook persists outgoing messages itself; its save command exports a file.
  mail.open(message);
  mail.activate();
}`;

// Classic Outlook's COM API imports attachments before the private staging
// directory is removed. New Outlook has no COM API; its web/mailto actions
// remain available separately. Message data never becomes PowerShell source.
export const WINDOWS_OUTLOOK_DRAFT_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
$draft = [Console]::In.ReadToEnd() | ConvertFrom-Json
try { $outlook = New-Object -ComObject Outlook.Application }
catch { [Console]::Error.WriteLine('LEGALWORK_OUTLOOK_UNAVAILABLE'); exit 1 }
try {
  $message = $outlook.CreateItem(0)
  $message.Subject = [string]$draft.subject
  $message.BodyFormat = 1
  $message.Body = [string]$draft.body
  foreach ($address in $draft.to) { $recipient = $message.Recipients.Add([string]$address); $recipient.Type = 1 }
  foreach ($address in $draft.cc) { $recipient = $message.Recipients.Add([string]$address); $recipient.Type = 2 }
  foreach ($address in $draft.bcc) { $recipient = $message.Recipients.Add([string]$address); $recipient.Type = 3 }
  $message.Save()
  foreach ($file in $draft.attachments) { $null = $message.Attachments.Add([string]$file, 1) }
  if ($message.Attachments.Count -ne @($draft.attachments).Count) { throw 'Attachment import failed' }
  $message.Save()
  $message.Display($false)
} catch { [Console]::Error.WriteLine('LEGALWORK_OUTLOOK_DRAFT_FAILED'); exit 1 }
`;

/** @param {string} input */
function runWindowsOutlookScript(input) {
  return new Promise((resolve, reject) => {
    const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = execFile(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", Buffer.from(WINDOWS_OUTLOOK_DRAFT_SCRIPT, "utf16le").toString("base64")],
      { timeout: 120000, maxBuffer: 64000, windowsHide: true }, (error, _stdout, stderr) => {
        if (!error) { resolve(undefined); return; }
        reject(new Error(stderr.includes("LEGALWORK_OUTLOOK_UNAVAILABLE")
          ? "This action requires classic Outlook for Windows. For new Outlook, use Open in Mail or Outlook web."
          : "Outlook could not finish opening the draft. Check Outlook for a partially created draft before trying again."));
      });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/** @param {string} input
 * @param {string} script
 * @param {string} appName
 * @param {string} automationName
 */
function runMailScript(input, script, appName, automationName) {
  return new Promise((resolve, reject) => {
    const child = execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script],
      { timeout: 120000, maxBuffer: 64000 }, (error) => {
        if (!error) { resolve(undefined); return; }
        if (error.message.includes("-1743")) {
          reject(new Error(`Allow LegalWork to control ${automationName} in System Settings > Privacy & Security > Automation, then try again.`));
        } else {
          reject(new Error(`${appName} could not finish opening the draft. Check ${appName} for a partially created draft before trying again.`));
        }
      });
    child.stdin.on("error", () => {}); // execFile's callback reports an early process exit.
    child.stdin.end(input);
  });
}

/** @param {string} input */
async function runOutlookScript(input) {
  // Prefer the installed application over backups registered with Launch Services.
  for (const applicationPath of ["/Applications/Microsoft Outlook.app", path.join(homedir(), "Applications/Microsoft Outlook.app")]) {
    try { await access(applicationPath); } catch { continue; }
    return runMailScript(JSON.stringify({ ...JSON.parse(input), applicationPath }), OUTLOOK_DRAFT_SCRIPT, "Outlook", "Microsoft Outlook");
  }
  throw new Error("Install Microsoft Outlook in Applications, or use Outlook web from the draft menu.");
}

/** @typedef {{ platform?: string, runScript?: (input: string) => Promise<unknown> }} MailDraftOptions */

/** @param {unknown} input @param {MailDraftOptions} [options] */
export async function composeAppleMailDraft(input, options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") throw new Error("Apple Mail drafts are available on macOS only.");
  return composeNativeMailDraft(input, "Apple Mail", {
    ...options, runScript: options.runScript ?? (value => runMailScript(value, APPLE_MAIL_DRAFT_SCRIPT, "Apple Mail", "Mail")),
  });
}

/** @param {unknown} input @param {MailDraftOptions} [options] */
export async function composeOutlookDraft(input, options = {}) {
  const platform = options.platform ?? process.platform;
  return composeNativeMailDraft(input, "Outlook", { ...options, runScript: options.runScript ?? (platform === "win32" ? runWindowsOutlookScript : runOutlookScript) });
}

/** Stages attachments until the mail application saves its own draft. Never sends mail.
 * @param {unknown} input
 * @param {string} appName
 * @param {{ platform?: string, runScript: (input: string) => Promise<unknown> }} options
 */
async function composeNativeMailDraft(input, appName, { platform = process.platform, runScript }) {
  if (platform !== "darwin" && platform !== "win32") throw new Error(`${appName} drafts are available on macOS and Windows only.`);
  const draft = draftSchema.parse(input);
  if (platform === "win32" && draft.attachments.some(({ name }) => /[<>:"|?*]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))) {
    throw new Error("An attachment filename is not supported on Windows. Rename it and try again.");
  }
  if (draft.attachments.reduce((size, item) => size + item.data.byteLength, 0) > 20 * 1024 * 1024) {
    throw new Error("Attachments must total 20 MB or less.");
  }
  const folder = await mkdtemp(path.join(tmpdir(), "legalwork-mail-"));
  try {
    await chmod(folder, 0o700);
    const attachments = [];
    for (const [index, item] of draft.attachments.entries()) {
      const directory = path.join(folder, String(index));
      await mkdir(directory, { mode: 0o700 });
      const target = path.join(directory, item.name);
      await writeFile(target, item.data, { mode: 0o600 });
      attachments.push(target);
    }
    // Mail imports these private copies before saving its own draft.
    await runScript(JSON.stringify({ ...draft, attachments }));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
