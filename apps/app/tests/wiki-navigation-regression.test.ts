import { describe, expect, test } from "bun:test";
import type { WikiPage } from "@legalwork/types/wiki";
import { wikiGraph, wikiNavigationPages } from "../src/react-app/domains/wiki/wiki-model";

function page(path: string, links: WikiPage["links"] = []): WikiPage {
  return { path, title: path.replace(/\.md$/, ""), type: "page", properties: {}, links, excerpt: "", revision: "a", updatedAt: 1 };
}

describe("Wiki navigation through large collections", () => {
  test("a hub after more than 60 backlinks stays visible and connected", () => {
    const hub = page("Hub.md");
    const neighbors = Array.from({ length: 80 }, (_, index) => page(`Notes/${index}.md`, [{ target: hub.path, label: "Hub", property: null, resolved: true }]));
    const graph = wikiGraph([...neighbors, hub], hub.path);
    expect(graph.pages).toHaveLength(81);
    expect(graph.pages[0]).toBe(hub);
    expect(graph.edges).toHaveLength(80);
    expect(graph.edges.every((edge) => edge.to === hub.path)).toBe(true);
    expect(graph.truncated).toBe(false);
    expect(wikiGraph([...neighbors, hub], null).pages).toEqual([...neighbors, hub]);
  });

  test("a page opened through a link beyond the sidebar limit is still selected", () => {
    const pages = Array.from({ length: 240 }, (_, index) => page(`Research/${index}.md`));
    const visible = wikiNavigationPages(pages, pages[210].path, 100);
    expect(visible).toHaveLength(100);
    expect(visible).toContain(pages[210]);
    expect(new Set(visible.map((entry) => entry.path)).size).toBe(100);
    expect(wikiNavigationPages(pages, pages[20].path, 100)).toEqual(pages.slice(0, 100));
    expect(wikiNavigationPages(pages, "Deleted.md", 100)).toEqual(pages.slice(0, 100));
    expect(wikiNavigationPages(pages, pages[210].path, 300)).toEqual(pages);
  });
});
