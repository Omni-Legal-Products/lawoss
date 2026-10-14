import type { WikiRegistration } from "@legalwork/types/wiki";
import type { OpenTarget } from "../session/artifacts/open-target";

export type WikiTabLocation =
  | { kind: "page"; path: string; anchor?: string; mode?: "source" }
  | { kind: "asset"; path: string }
  | { kind: "graph"; focus?: string };

export type WikiPanelTab = {
  id: string;
  type: "wiki";
  label: string;
  serverUrl: string;
  wikiId: string;
  location: WikiTabLocation;
};

/** Links to the same page select its tab; anchors do not create duplicate tabs. */
export function wikiPanelTab(serverUrl: string, wikiId: string, location: WikiTabLocation, label: string): WikiPanelTab {
  const target = (location.kind === "page" || location.kind === "asset") ? location.path : "";
  return { id: `wiki:${JSON.stringify([serverUrl, wikiId, location.kind, target])}`, type: "wiki", label, serverUrl, wikiId, location };
}

/** Chat file links in a wiki use the same tabs as its file tree. */
export function wikiTabForFileTarget(serverUrl: string, wiki: Pick<WikiRegistration, "id" | "root">, target: OpenTarget): WikiPanelTab | null {
  if (target.kind !== "file" || target.preview === "view") return null;
  const root = wiki.root.replace(/\\/g, "/").replace(/\/+$/, "");
  let path = target.value.replace(/\\/g, "/");
  if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1);
  if (/^\/|^[A-Za-z][A-Za-z0-9+.-]*:|^~\//.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== ".") parts.push(part);
  }
  path = parts.join("/");
  if (!path) return null;
  const page = /\.md$/i.test(path);
  const filename = parts[parts.length - 1];
  return wikiPanelTab(serverUrl, wiki.id, { kind: page ? "page" : "asset", path }, page ? filename.replace(/\.md$/i, "") : filename);
}
