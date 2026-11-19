import { afterAll, describe, expect, mock, test } from "bun:test";
import { act, createElement, type ReactNode } from "react";
import { setLocale, type Language } from "../src/i18n";
import en from "../src/i18n/locales/en";
import de from "../src/i18n/locales/de";
import sk from "../src/i18n/locales/sk";
import cs from "../src/i18n/locales/cs";
import type { CustomProviderEditData } from "../src/react-app/domains/connections/provider-auth/store";

/**
 * #580: dialóg „Vlastný poskytovateľ“ mal v slovenčine a češtine anglické texty natvrdo v kóde
 * („Runtime“, „Provider ID: … (fixed)“, „most endpoints“, „API key (optional)“, „Add“, „Tools“, …)
 * a pätička hovorila o „OpenCode“, ktoré používateľ LAWOSS nepozná.
 * Test pripojí skutočný dialóg (pridanie, lokálny model, úprava) a číta, čo by používateľ videl.
 */
const inline = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
const dialogPath = "../src/components/ui/dialog";
const dialog = { ...(await import(dialogPath)) };
mock.module(dialogPath, () => ({ ...dialog, Dialog: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline, DialogDescription: inline, DialogFooter: inline, DialogClose: inline }));
// Base UI Collapsible zatvorený obsah nevykreslí; ručné pridanie modelu a nastavenia modelu sa tu ukážu priamo.
const collapsiblePath = "../src/components/ui/collapsible";
const collapsible = { ...(await import(collapsiblePath)) };
mock.module(collapsiblePath, () => ({ ...collapsible, Collapsible: inline, CollapsibleContent: inline, CollapsibleTrigger: inline }));
afterAll(() => {
  mock.module(dialogPath, () => dialog);
  mock.module(collapsiblePath, () => collapsible);
});
const { default: ProviderAuthModal } = await import("../src/react-app/domains/connections/provider-auth/provider-auth-modal");

/** Toľko DOM, koľko React a Base UI potrebujú na pripojenie dialógu; v teste žiadny prehliadač nie je. */
class FakeNode {
  nodeName: string;
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attributes = new Map<string, string>();
  style = {};
  value?: string;
  nodeValue: string | null = null;
  options: FakeNode[] = [];
  constructor(name: string, readonly ownerDocument: unknown, readonly nodeType = 1) {
    this.nodeName = this.tagName = name.toUpperCase();
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  set textContent(text: string) {
    this.childNodes = [];
    if (text) {
      const node = new FakeNode("#text", this.ownerDocument, 3);
      node.nodeValue = text;
      this.appendChild(node);
    }
  }
  get textContent(): string { return this.nodeType === 3 ? this.nodeValue ?? "" : this.childNodes.map((child) => child.textContent).join(""); }
  appendChild(child: FakeNode) { return this.insertBefore(child, null); }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, child);
    return child;
  }
  removeChild(child: FakeNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
}

/** Riadky poskladané z viacerých textových uzlov („ID poskytovateľa:“ + id + „(nemenné)“). */
function lines(node: FakeNode): string[] {
  const own = node.nodeType === 1 && node.childNodes.length > 1 ? [node.textContent.replace(/\s+/g, " ").trim()] : [];
  return [...own, ...node.childNodes.flatMap(lines)];
}

/** Texty, ktoré používateľ uvidí alebo mu prečíta čítačka: text, zástupný text, popisky. */
function visibleTexts(node: FakeNode): string[] {
  if (node.nodeType === 3) return node.nodeValue?.trim() ? [node.nodeValue.trim()] : [];
  const own = ["placeholder", "aria-label", "title"].flatMap((name) => node.attributes.get(name) ?? []);
  return [...own, ...node.childNodes.flatMap(visibleTexts)];
}

const edit: CustomProviderEditData = {
  providerId: "kancelaria-llm",
  name: "Kancelária LLM",
  baseURL: "https://llm.kancelaria.invalid/v1",
  endpointConfigured: true,
  apiType: "chat",
  models: [{ id: "qwen2.5:test", toolCall: true, reasoning: false, contextLimit: null, outputLimit: null }],
};

type Mode = { preferredProviderId?: string; customEdit?: CustomProviderEditData };

async function renderDialog(locale: Language, mode: Mode): Promise<{ texts: string[]; lines: string[] }> {
  setLocale(locale);
  const names = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const before = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const fakeDocument = {
    addEventListener() {}, removeEventListener() {},
    createElement: (name: string) => new FakeNode(name, fakeDocument),
    createElementNS: (_namespace: string, name: string) => new FakeNode(name, fakeDocument),
    createTextNode: (text: string) => Object.assign(new FakeNode("#text", fakeDocument, 3), { nodeValue: text }),
  };
  const fakeWindow = { event: undefined, document: fakeDocument, HTMLElement: FakeNode, HTMLIFrameElement: class {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FakeNode });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  try {
    const { createRoot } = await import("react-dom/client");
    const container = new FakeNode("div", fakeDocument);
    const root = createRoot(container as unknown as Element);
    try {
      await act(async () => {
        root.render(
          <ProviderAuthModal
            open
            allowChatGptSubscription={false}
            loading={false}
            submitting={false}
            error={null}
            providers={[]}
            connectedProviderIds={[]}
            authMethods={{}}
            preferredProviderId={mode.preferredProviderId}
            customEdit={mode.customEdit}
            onSelect={async () => { throw new Error("neočakávaný výber"); }}
            onSubmitApiKey={async () => { throw new Error("neočakávaný kľúč"); }}
            onSubmitOAuth={async () => { throw new Error("neočakávaný OAuth"); }}
            onFetchCustomModels={async () => []}
            onSubmitCustomProvider={async () => {}}
            onClose={() => {}}
          />,
        );
      });
      await act(async () => { await Promise.resolve(); });
      return { texts: visibleTexts(container), lines: lines(container) };
    } finally { await act(async () => { root.unmount(); }); }
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
}

const MODES: Record<string, Mode> = {
  pridanie: { preferredProviderId: "__custom_openai_compatible__" },
  "lokálny model": { preferredProviderId: "__local_model__" },
  úprava: { customEdit: edit },
};

const ENGLISH = [
  "Runtime", "Local model", "Provider ID", "(fixed)", "most endpoints", "API key", "API key (optional)", "Add",
  "Tools", "Reasoning", "Context", "Output", "auto", "Saving…", "Adding…", "OpenCode",
];

describe("#580: dialóg Vlastný poskytovateľ bez anglických textov", () => {
  for (const locale of ["sk", "cs", "de"] as const) {
    for (const [name, mode] of Object.entries(MODES)) {
      test(`${locale}: ${name}`, async () => {
        const { texts } = await renderDialog(locale, mode);
        expect(texts.length).toBeGreaterThan(10);
        const english = texts.filter((text) => ENGLISH.some((word) => new RegExp(`(^|[^\\p{L}])${word.replace(/[()]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(text)));
        expect(english).toEqual([]);
      });
    }
  }

  test("sk: preložené texty sú na svojom mieste", async () => {
    const { texts: add } = await renderDialog("sk", MODES.pridanie);
    expect(add).toContain("Kľúč API (nepovinné)");
    expect(add).toContain("Pridať");
    expect(add).toContain("Kľúče sa ukladajú len v tomto počítači.");
    expect(add.some((text) => text.startsWith("/v1/chat/completions ·") && text.includes("väčšina"))).toBe(true);
    const local = (await renderDialog("sk", MODES["lokálny model"])).texts;
    expect(local).toContain("Lokálny server");
    expect(local).toContain("Lokálny model");
    const { texts: editTexts, lines: editLines } = await renderDialog("sk", MODES.úprava);
    expect(editTexts).toContain("Kľúč API");
    expect(editLines).toContain("ID poskytovateľa: kancelaria-llm (nemenné)");
    for (const text of ["Nástroje", "Uvažovanie", "Kontext", "Výstup"]) expect(editTexts).toContain(text);
  });

  test("en: anglické znenie ostáva, pätička bez OpenCode", async () => {
    const { texts: add } = await renderDialog("en", MODES.pridanie);
    expect(add).toContain("API key (optional)");
    expect(add).toContain("Add");
    expect(add.join("\n")).not.toContain("OpenCode");
  });

  test("hláška o uložení kľúčov nespomína OpenCode v žiadnom jazyku", () => {
    for (const dict of [en, de, sk, cs]) {
      expect(dict["lawoss.providers.keys_stored_locally"]).not.toContain("OpenCode");
    }
  });
});
