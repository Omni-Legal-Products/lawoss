import type { Link, Nodes } from "mdast";
import type { Extension as MdastExtension } from "mdast-util-from-markdown";
import { defaultHandlers, type Options } from "mdast-util-to-markdown";
import type { Extension, State, Tokenizer } from "micromark-util-types";
import { parseViewReference } from "../views/view-reference";

declare module "micromark-util-types" {
  interface TokenTypeMap { wikiLink: "wikiLink" }
}

/** Parse wiki links as ordinary editor links, without touching code or escaped brackets. */
const tokenizeWikiLink: Tokenizer = function (effects, ok, nok) {
  let content = "";
  const start: State = (code) => {
    effects.enter("wikiLink"); effects.consume(code); return secondBracket;
  };
  const secondBracket: State = (code) => {
    if (code !== 91) return nok(code);
    effects.consume(code); return inside;
  };
  const inside: State = (code) => {
    if (code === null || code < 0 || code === 91) return nok(code);
    if (code === 93) {
      if (!content.split("|")[0].trim()) return nok(code);
      effects.consume(code); return close;
    }
    content += String.fromCharCode(code); effects.consume(code); return inside;
  };
  const close: State = (code) => {
    if (code !== 93) return nok(code);
    effects.consume(code); effects.exit("wikiLink"); return ok;
  };
  return start;
};

export const wikiLinkSyntax: Extension = { text: { 91: { name: "wikiLink", tokenize: tokenizeWikiLink } } };
/** Keep relative paths and supported app URLs intact through Lexical's URL sanitizer. */
export function wikiEditorLinkTarget(url: string): string {
  if (!url.startsWith("#wiki-path:")) return url;
  try { return decodeURIComponent(url.slice("#wiki-path:".length)); }
  catch { return url; }
}

function preserveEditorLinks(node: Nodes) {
  if (node.type === "link" && node.url && (parseViewReference(node.url) || (!node.url.startsWith("[[") && !/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(node.url)))) node.url = `#wiki-path:${encodeURIComponent(node.url)}`;
  if ("children" in node) node.children.forEach(preserveEditorLinks);
}

export const wikiLinkFromMarkdown: MdastExtension = {
  transforms: [preserveEditorLinks],
  enter: {
    wikiLink(token) {
      const source = this.sliceSerialize(token).slice(2, -2).replace(/\\\|/g, "|");
      const separator = source.indexOf("|");
      const target = separator < 0 ? source : source.slice(0, separator);
      const label = separator < 0 ? target : source.slice(separator + 1);
      this.enter({ type: "link", url: `#wiki:${encodeURIComponent(target)}`, children: [{ type: "text", value: label }] }, token);
    },
  },
  exit: { wikiLink(token) { this.exit(token); } },
};

export const wikiLinkToMarkdown: Options = {
  handlers: {
    link(node: Link, parent, state, info) {
      if (node.url.startsWith("#wiki-path:")) return defaultHandlers.link({ ...node, url: wikiEditorLinkTarget(node.url) }, parent, state, info);
      // Markdown links with a hover title or formatting retain the full Markdown form.
      if (node.title || node.children.some((child) => child.type !== "text")) return defaultHandlers.link(node, parent, state, info);
      // The standard Create Link dialog also accepts [[Page]] as its destination.
      const authoredWikiLink = /^\[\[([^\]\n]+)\]\]$/.exec(node.url);
      let target: string;
      if (authoredWikiLink) target = authoredWikiLink[1].split("|")[0];
      else if (/^#?wiki:/.test(node.url)) {
        try { target = decodeURIComponent(node.url.replace(/^#?wiki:/, "")); }
        catch { return defaultHandlers.link(node, parent, state, info); }
      } else return defaultHandlers.link(node, parent, state, info);
      let label = node.children.map((child) => child.type === "text" ? child.value : "").join("");
      if (authoredWikiLink && (label === node.url || !label)) label = authoredWikiLink[1].split("|")[1] ?? target;
      if (!target.trim() || /[\[\]\n|]/.test(target) || /[\[\]\n]/.test(label)) return defaultHandlers.link(node, parent, state, info);
      const value = `[[${target}${label === target ? "" : `|${label}`}]]`;
      return state.stack.includes("tableCell") ? value.replace(/\|/g, "\\|") : value;
    },
  },
};
