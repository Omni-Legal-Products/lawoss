import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ConnectorRequest } from "./request.js";

const account = { connectionId: z.string().min(1).max(500).optional() };
export const mailListInput = z.object({ ...account, query: z.string().max(1000).optional(), maxResults: z.number().int().min(1).max(50).default(10), pageToken: z.string().max(8192).optional() }).strict();
export const mailMessageInput = z.object({ ...account, messageId: z.string().min(1).max(1000) }).strict();
export const mailAttachmentInput = mailMessageInput.extend({ attachmentId: z.string().min(1).max(1000) }).strict();
export const mailDraftInput = z.object({ ...account,
  to: z.array(z.email()).min(1).max(100), cc: z.array(z.email()).max(100).default([]), bcc: z.array(z.email()).max(100).default([]),
  subject: z.string().max(500).refine((value) => !/[\r\n]/.test(value), "Subject must be a single line."),
  body: z.string().max(200_000),
}).strict();
export const mailStatusInput = z.object(account).strict();

type GmailPart = { mimeType?: string; filename?: string; headers?: { name: string; value: string }[]; body?: { data?: string; attachmentId?: string; size?: number }; parts?: GmailPart[] };
const gmailPart: z.ZodType<GmailPart> = z.lazy(() => z.object({
  mimeType: z.string().optional(), filename: z.string().optional(),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  body: z.object({ data: z.string().optional(), attachmentId: z.string().optional(), size: z.number().optional() }).optional(),
  parts: z.array(gmailPart).optional(),
}));
const gmailMessage = z.object({ id: z.string(), threadId: z.string().optional(), snippet: z.string().optional(), labelIds: z.array(z.string()).optional(), payload: gmailPart.optional() });
const outlookAddress = z.object({ emailAddress: z.object({ name: z.string().optional(), address: z.string() }) });
const outlookMessage = z.object({ id: z.string(), subject: z.string().nullish(), from: outlookAddress.nullish(),
  toRecipients: z.array(outlookAddress).nullish(), receivedDateTime: z.string().nullish(), hasAttachments: z.boolean().nullish(),
  bodyPreview: z.string().nullish(), conversationId: z.string().nullish(),
  body: z.object({ contentType: z.string(), content: z.string() }).nullish(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(502, "connector_api_invalid", "The email provider returned an invalid response.");
  return result.data;
}

function gmailSummary(message: z.infer<typeof gmailMessage>) {
  const header = (name: string) => message.payload?.headers?.find((entry) => entry.name.toLowerCase() === name)?.value ?? null;
  return { id: message.id, threadId: message.threadId ?? null, subject: header("subject"), from: header("from"), to: header("to"), date: header("date"), snippet: message.snippet ?? "", labels: message.labelIds ?? [] };
}

function gmailBody(part: GmailPart | undefined, mimeType: string): string {
  if (!part) return "";
  if (part.mimeType === mimeType && !part.filename && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts ?? []).map((child) => gmailBody(child, mimeType)).filter(Boolean).join("\n");
}

function gmailAttachments(part: GmailPart | undefined): { id: string; filename: string; mimeType: string | null; size: number | null }[] {
  if (!part) return [];
  const own = part.filename && part.body?.attachmentId
    ? [{ id: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType ?? null, size: part.body.size ?? null }] : [];
  return [...own, ...(part.parts ?? []).flatMap(gmailAttachments)];
}

function outlookSummary(message: z.infer<typeof outlookMessage>) {
  return { id: message.id, threadId: message.conversationId ?? null, subject: message.subject ?? "",
    from: message.from?.emailAddress.address ?? null, to: message.toRecipients?.map((item) => item.emailAddress.address) ?? [],
    date: message.receivedDateTime ?? null, snippet: message.bodyPreview ?? "", hasAttachments: message.hasAttachments ?? false };
}

function outlookPagePath(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ApiError(400, "invalid_page_token", "Invalid Outlook page token."); }
  if (url.origin !== "https://graph.microsoft.com" || url.pathname !== "/v1.0/me/messages" || url.username || url.password || url.hash) {
    throw new ApiError(400, "invalid_page_token", "Invalid Outlook page token.");
  }
  return `${url.pathname}${url.search}`;
}

export const gmailAdapter = {
  async test(request: ConnectorRequest) {
    parse(z.object({ emailAddress: z.string() }), await request("/gmail/v1/users/me/profile?fields=emailAddress"));
    return { ok: true, message: "Gmail access verified directly with Google." };
  },
  async list(request: ConnectorRequest, input: z.infer<typeof mailListInput>) {
    const query = new URLSearchParams({ maxResults: String(input.maxResults) });
    if (input.query) query.set("q", input.query);
    if (input.pageToken) query.set("pageToken", input.pageToken);
    const page = parse(z.object({ messages: z.array(z.object({ id: z.string() })).default([]), nextPageToken: z.string().optional(), resultSizeEstimate: z.number().optional() }),
      await request(`/gmail/v1/users/me/messages?${query}`));
    const messages = await Promise.all(page.messages.map(async ({ id }) => gmailSummary(parse(gmailMessage,
      await request(`/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`)))));
    return { messages, nextPageToken: page.nextPageToken ?? null, resultSizeEstimate: page.resultSizeEstimate ?? null };
  },
  async get(request: ConnectorRequest, input: z.infer<typeof mailMessageInput>) {
    const message = parse(gmailMessage, await request(`/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}?format=full`));
    const text = gmailBody(message.payload, "text/plain");
    return { ...gmailSummary(message), body: text || gmailBody(message.payload, "text/html"), bodyType: text ? "text" : "html", attachments: gmailAttachments(message.payload) };
  },
  async attachment(request: ConnectorRequest, input: z.infer<typeof mailAttachmentInput>) {
    const data = parse(z.object({ data: z.string(), size: z.number() }), await request(`/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(input.attachmentId)}`));
    if (data.size > 5 * 1024 * 1024) throw new ApiError(413, "attachment_too_large", "This attachment exceeds the 5 MB connector limit.");
    return { dataBase64: Buffer.from(data.data, "base64url").toString("base64"), size: data.size };
  },
  async draft(request: ConnectorRequest, input: z.infer<typeof mailDraftInput>) {
    const headers = [`To: ${input.to.join(", ")}`];
    if (input.cc.length) headers.push(`Cc: ${input.cc.join(", ")}`);
    if (input.bcc.length) headers.push(`Bcc: ${input.bcc.join(", ")}`);
    headers.push(`Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
    const body = Buffer.from(input.body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
    const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`).toString("base64url");
    const result = parse(z.object({ id: z.string(), message: z.object({ id: z.string() }) }), await request("/gmail/v1/users/me/drafts", { method: "POST", body: { message: { raw } } }));
    return { id: result.id, messageId: result.message.id, sent: false };
  },
};

export const outlookAdapter = {
  async test(request: ConnectorRequest) {
    parse(z.object({ value: z.array(z.object({ id: z.string() })) }), await request("/v1.0/me/messages?$top=1&$select=id"));
    return { ok: true, message: "Outlook access verified directly with Microsoft." };
  },
  async list(request: ConnectorRequest, input: z.infer<typeof mailListInput>) {
    const query = new URLSearchParams({ "$top": String(input.maxResults), "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,conversationId" });
    if (input.query) query.set("$search", `"${input.query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    const path = input.pageToken ? outlookPagePath(input.pageToken) : `/v1.0/me/messages?${query}`;
    const page = parse(z.object({ value: z.array(outlookMessage), "@odata.nextLink": z.string().optional() }), await request(path));
    if (page["@odata.nextLink"]) outlookPagePath(page["@odata.nextLink"]);
    return { messages: page.value.map(outlookSummary), nextPageToken: page["@odata.nextLink"] ?? null };
  },
  async get(request: ConnectorRequest, input: z.infer<typeof mailMessageInput>) {
    const message = parse(outlookMessage, await request(`/v1.0/me/messages/${encodeURIComponent(input.messageId)}?$select=id,subject,from,toRecipients,receivedDateTime,body,bodyPreview,hasAttachments,conversationId`));
    const attachments = message.hasAttachments ? parse(z.object({ value: z.array(z.object({ id: z.string(), name: z.string(), contentType: z.string(), size: z.number(), "@odata.type": z.string().optional() })) }),
      await request(`/v1.0/me/messages/${encodeURIComponent(input.messageId)}/attachments?$select=id,name,contentType,size`)).value : [];
    return { ...outlookSummary(message), body: message.body?.content ?? "", bodyType: message.body?.contentType ?? "text",
      attachments: attachments.map((entry) => ({ id: entry.id, filename: entry.name, mimeType: entry.contentType, size: entry.size })) };
  },
  async attachment(request: ConnectorRequest, input: z.infer<typeof mailAttachmentInput>) {
    const attachment = parse(z.object({ "@odata.type": z.string(), name: z.string(), contentType: z.string(), size: z.number(), contentBytes: z.string().optional() }),
      await request(`/v1.0/me/messages/${encodeURIComponent(input.messageId)}/attachments/${encodeURIComponent(input.attachmentId)}`));
    if (attachment["@odata.type"] !== "#microsoft.graph.fileAttachment" || !attachment.contentBytes) throw new ApiError(400, "attachment_not_file", "This Outlook attachment is not a downloadable file.");
    if (attachment.size > 5 * 1024 * 1024) throw new ApiError(413, "attachment_too_large", "This attachment exceeds the 5 MB connector limit.");
    return { dataBase64: attachment.contentBytes, filename: attachment.name, mimeType: attachment.contentType, size: attachment.size };
  },
  async draft(request: ConnectorRequest, input: z.infer<typeof mailDraftInput>) {
    const recipients = (values: string[]) => values.map((address) => ({ emailAddress: { address } }));
    const draft = parse(z.object({ id: z.string() }), await request("/v1.0/me/messages", { method: "POST", body: {
      subject: input.subject, body: { contentType: "Text", content: input.body },
      toRecipients: recipients(input.to), ccRecipients: recipients(input.cc), bccRecipients: recipients(input.bcc),
    } }));
    return { id: draft.id, messageId: draft.id, sent: false };
  },
};
