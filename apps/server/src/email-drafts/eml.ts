import { randomUUID } from "node:crypto";
import { emailMailboxes, type EmailDraftInput } from "./schema.js";

export type EmailAttachment = { name: string; contentType: string; data: Buffer };
const CRLF = "\r\n";
const base64 = (data: Buffer) => data.toString("base64").match(/.{1,76}/g)?.join(CRLF) ?? "";

function encodedWords(value: string): string {
  // Each encoded word stays below RFC 2047's 75-character limit, without
  // splitting a Unicode code point. Folding preserves long subjects.
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) { chunks.push(chunk); chunk = ""; }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(text => `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`).join(`${CRLF} `);
}

function addresses(value: string): string {
  return emailMailboxes(value).map(mailbox => {
    const match = /^(.*)<([^<>]+)>\s*$/.exec(mailbox);
    if (!match || !/[^\x20-\x7e]/.test(match[1])) return mailbox;
    const name = match[1].trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
    return `${encodedWords(name)} <${match[2]}>`;
  }).join(`,${CRLF} `);
}

function textPart(type: string, text: string): string {
  return [`Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", base64(Buffer.from(text.replace(/\r?\n/g, CRLF))), ""].join(CRLF);
}

/** Render a draft, never send it. Attachments are snapshotted into the EML. */
export function renderEml(input: EmailDraftInput, attachments: EmailAttachment[], date = new Date()): string {
  for (const value of [input.from, input.replyTo, input.to, input.cc, input.bcc, input.subject, ...attachments.map(item => item.name)]) {
    if (/[\r\n\u0000]/.test(value)) throw new Error("Email headers must be a single line.");
  }
  const headers = [`Date: ${date.toUTCString()}`, `Message-ID: <${randomUUID()}@legalwork.local>`, "MIME-Version: 1.0", "X-Unsent: 1"];
  for (const [key, value] of [["From", input.from], ["Reply-To", input.replyTo], ["To", input.to], ["Cc", input.cc], ["Bcc", input.bcc]]) {
    if (value) headers.push(`${key}: ${addresses(value)}`);
  }
  headers.push(`Subject: ${input.subject ? encodedWords(input.subject) : ""}`);
  let body = textPart("text/plain", input.body);
  if (input.html) {
    const boundary = `alternative-${randomUUID()}`;
    body = [`Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, body, `--${boundary}`, textPart("text/html", input.html), `--${boundary}--`, ""].join(CRLF);
  }
  if (attachments.length) {
    const boundary = `mixed-${randomUUID()}`;
    const parts = attachments.map(item => {
      if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(item.contentType)) throw new Error("Invalid attachment content type.");
      const filename = encodeURIComponent(item.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      const segments: string[] = []; let segment = "";
      for (const token of filename.match(/%[0-9A-F]{2}|./g) ?? []) {
        if (segment.length + token.length > 60) { segments.push(segment); segment = ""; }
        segment += token;
      }
      segments.push(segment);
      const extendedName = segments.length === 1 ? ` filename*=UTF-8''${filename}` : segments.map((part, index) => ` filename*${index}*=${index === 0 ? "UTF-8''" : ""}${part}${index < segments.length - 1 ? ";" : ""}`).join(CRLF);
      return [`--${boundary}`, `Content-Type: ${item.contentType}`, "Content-Transfer-Encoding: base64", "Content-Disposition: attachment;", extendedName, "", base64(item.data), ""].join(CRLF);
    });
    body = [`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`, body, ...parts, `--${boundary}--`, ""].join(CRLF);
  }
  return [...headers, body].join(CRLF);
}
