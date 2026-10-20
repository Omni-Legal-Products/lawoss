import type { FilePartInput } from "@opencode-ai/sdk/v2/client";
import type { ComposerAttachment, ComposerDraft, ComposerPart } from "@/app/types";
import type { ComposerPastePart } from "../composer-state-store";
import {
  decodeComposerMentionValue, encodeComposerMentionValue, legalMemoryComposerInstruction, legalMemoryComposerDisplayText,
  storageComposerInstruction, storageComposerDisplayText, reviewComposerInstruction, reviewComposerDisplayText,
  calendarComposerInstruction, calendarComposerDisplayText, taskComposerInstruction, taskComposerDisplayText,
  parsePluginComposerMention, pluginComposerDisplayText, type ComposerMentionKind,
} from "./mention-encoding";
import { workspaceAttachmentInstruction, workspaceAttachmentDisplayText, parseWorkspaceAttachmentMention } from "./workspace-attachment";
import { parseSlashCommandInvocation } from "./slash-command";

// UI provenance only: these references originate at the structured upload
// mention boundary. The host's current selected-original hash check remains
// the authority; this map grants no filesystem access or transfer permission.
const uploadParts = new WeakMap<ComposerPart, {reference: string; displayText: string}>();

export function protectedWorkspaceUploadParts(draft: ComposerDraft, workspaceRoot: string): ReadonlyMap<ComposerPart, FilePartInput> {
  const files = new Map<ComposerPart, FilePartInput>();
  for (const part of draft.parts) {
    const provenance = uploadParts.get(part);
    if (!provenance) continue;
    if (part.type !== "text" || part.text !== provenance.displayText) throw new Error("The selected upload reference changed; attach it again.");
    const attachment = parseWorkspaceAttachmentMention(provenance.reference);
    if (!attachment || attachment.source || !/^\.legalwork\/attachments\/[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\/[a-zA-Z0-9._-]+$/.test(attachment.path))
      throw new Error("Attach a saved copy of a selected original before continuing this protected operation.");
    const root = workspaceRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!(root.startsWith("/") && !root.startsWith("//")) && !/^[A-Za-z]:\//.test(root)) throw new Error("The registered workspace root is unavailable.");
    const absolute = `${root}/${attachment.path}`;
    const encoded = absolute.split("/").map(encodeURIComponent).join("/");
    const url = /^[A-Za-z]:\//.test(absolute) ? `file:///${encoded.replace(/^([A-Za-z])%3A/, "$1:")}` : `file://${encoded}`;
    files.set(part, {type: "file", url, filename: attachment.name, mime: "application/octet-stream"});
  }
  return files;
}

export function buildComposerDraft(
  text: string,
  nextAttachments: ComposerAttachment[],
  mentions: Record<string, ComposerMentionKind>,
  pasteParts: readonly ComposerPastePart[],
): ComposerDraft {
  const effectiveMentions = { ...mentions };
  const modelContexts: string[] = [];
  const parts: ComposerPart[] = text.split(/(\[pasted text [^\]]+\]|\[skill [^\]]+\]|@[^\s@]+)/).flatMap<ComposerPart>((segment) => {
    if (!segment) return [];
    const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
    if (pasteMatch) {
      const target = pasteParts.find((item) => item.label === pasteMatch[1]);
      if (target) {
        return [{ type: "paste", id: target.id, label: target.label, text: target.text, lines: target.lines }];
      }
    }
    const skillMatch = segment.match(/^\[skill (.+)\]$/);
    if (skillMatch?.[1]) {
      return [{ type: "skill", name: skillMatch[1] } satisfies ComposerDraft["parts"][number]];
    }
    if (segment.startsWith("@")) {
      const value = decodeComposerMentionValue(segment.slice(1));
      const kind = effectiveMentions[value] ?? (parsePluginComposerMention(value) ? "plugin" : undefined);
      if (kind === "plugin") effectiveMentions[value] = kind;
      if (kind === "agent") return [{ type: "agent", name: value } satisfies ComposerDraft["parts"][number]];
      if (kind === "plugin") {
        const plugin = parsePluginComposerMention(value);
        if (plugin) return [{ type: "plugin", ...plugin } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "file") return [{ type: "file", path: value, label: value } satisfies ComposerDraft["parts"][number]];
      if (kind === "upload") {
        modelContexts.push(workspaceAttachmentInstruction(value));
        const part: ComposerPart = {type: "text", text: workspaceAttachmentDisplayText(value)};
        uploadParts.set(part, {reference: value, displayText: part.text});
        return [part];
      }
      if (kind === "memory") {
        modelContexts.push(legalMemoryComposerInstruction(value));
        return [{ type: "text", text: legalMemoryComposerDisplayText(value) } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "storage") {
        modelContexts.push(storageComposerInstruction(value));
        return [{ type: "text", text: storageComposerDisplayText(value) } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "review") {
        modelContexts.push(reviewComposerInstruction(value));
        return [{ type: "text", text: reviewComposerDisplayText(value) } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "calendar") {
        modelContexts.push(calendarComposerInstruction(value));
        return [{ type: "text", text: calendarComposerDisplayText(value) } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "task") {
        modelContexts.push(taskComposerInstruction(value));
        return [{ type: "text", text: taskComposerDisplayText(value) } satisfies ComposerDraft["parts"][number]];
      }
      if (kind === "app") return [{ type: "app", name: value } satisfies ComposerDraft["parts"][number]];
    }
    return [{ type: "text", text: segment } satisfies ComposerDraft["parts"][number]];
  });
  // Expand paste placeholders in resolvedText so the model receives
  // the actual pasted content instead of "[pasted text <label>]".
  let resolved = text;
  for (const part of pasteParts) {
    resolved = resolved.replace(`[pasted text ${part.label}]`, () => part.text);
  }
  resolved = resolved.replace(/\[skill ([^\]]+)\]/g, (_match, name: string) => `the \"${name}\" skill`);
  for (const [value, kind] of Object.entries(effectiveMentions)) {
    resolved = resolved.replaceAll(
      `@${encodeComposerMentionValue(value)}`,
      kind === "plugin"
        ? pluginComposerDisplayText(value)
        : kind === "memory"
        ? legalMemoryComposerDisplayText(value)
        : kind === "storage"
          ? storageComposerDisplayText(value)
          : kind === "review"
            ? reviewComposerDisplayText(value)
          : kind === "calendar"
            ? calendarComposerDisplayText(value)
          : kind === "task"
            ? taskComposerDisplayText(value)
            : kind === "upload"
              ? workspaceAttachmentDisplayText(value)
              : `@${value}`,
    );
  }
  const slashCommand = parts.some(part => part.type === "plugin") ? null : parseSlashCommandInvocation(resolved);
  return {
    mode: "prompt",
    parts,
    attachments: nextAttachments,
    text,
    resolvedText: resolved,
    modelContext: [...new Set(modelContexts)].join("\n") || undefined,
    command: slashCommand ?? undefined,
  };
}
