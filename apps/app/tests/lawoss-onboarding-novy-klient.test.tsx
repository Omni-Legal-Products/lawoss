import { describe, expect, test } from "bun:test";
import { act } from "react";

import { Client, clientFormValid, welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";

/**
 * Nový klient sa nedal pridať: „Náhľad zmien“ ostal vypnutý aj s vyplneným názvom a priečinkom.
 * Predvolený režim pripojenia existujúceho priečinka je `trial_clone` a jeho „kam uložiť kópiu“
 * (odvodené z názvu klienta, teda prázdne) sa kontrolovalo aj pri novom klientovi.
 */
const newClient = {
  existing: false,
  value: "Testovací klient s.r.o.",
  clientParent: "/Users/advokat/Prax/Klienti",
  memoryPath: "",
  identityAnchor: "",
  cloneParent: "",
  confirmedWrite: false,
  confirmedClient: false,
};

const FOLDER = "/Users/advokat/Prax/Klienti";

/** Toľko DOM, koľko React a Base UI potrebujú na skutočné pripojenie formulára; v teste žiadny prehliadač nie je. */
class FakeNode {
  nodeName: string;
  tagName: string;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  style = {};
  value?: string;
  options: FakeNode[] = []; // React číta z <select> zoznam možností.
  constructor(name: string, readonly ownerDocument: unknown, readonly nodeType = 1) {
    this.nodeName = this.tagName = name.toUpperCase();
  }
  appendChild(child: FakeNode) { return this.insertBefore(child, null); }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, child);
    return child;
  }
  removeChild(child: FakeNode) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; return child; }
  setAttribute() {}
  removeAttribute() {}
  addEventListener() {}
  removeEventListener() {}
}

async function withClientForm(run: (form: { render: (base: OnboardingProfile) => Promise<void>; inputValues: () => string[] }) => Promise<void>) {
  const names = ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const before = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  const fakeDocument = {
    addEventListener() {}, removeEventListener() {},
    createElement: (name: string) => new FakeNode(name, fakeDocument),
    createTextNode: () => new FakeNode("#text", fakeDocument, 3),
  };
  const fakeWindow = { event: undefined, document: fakeDocument, HTMLElement: FakeNode, HTMLIFrameElement: class {} };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: fakeDocument });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FakeNode }); // Base UI Button ním rozozná <button>.
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  try {
    const { createRoot } = await import("react-dom/client");
    const container = new FakeNode("div", fakeDocument);
    const root = createRoot(container as unknown as Element);
    const inputs = (node: FakeNode): FakeNode[] => [...(node.nodeName === "INPUT" ? [node] : []), ...node.childNodes.flatMap(inputs)];
    try {
      await run({
        render: async (base) => { await act(async () => { root.render(<Client base={base} locale="cs" tr={welcomeText("cs")} busy={false} onPlan={async () => {}} addingClient />); }); },
        inputValues: () => inputs(container).map((input) => input.value ?? ""),
      });
    } finally { await act(async () => { root.unmount(); }); }
  } finally {
    for (const [name, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
  }
}

describe("nový klient", () => {
  test("stačí názov a nadradený priečinok pri každom predvolenom režime", () => {
    for (const mode of ["trial_clone", "convert", "map"] as const) {
      expect({ mode, valid: clientFormValid({ ...newClient, mode }) }).toEqual({ mode, valid: true });
    }
  });

  test("bez názvu alebo priečinka sa náhľad nespustí", () => {
    expect(clientFormValid({ ...newClient, mode: "trial_clone", value: "  " })).toBe(false);
    expect(clientFormValid({ ...newClient, mode: "trial_clone", clientParent: "" })).toBe(false);
  });

  test("priečinok Klienti sa predvyplní, aj keď profil príde až po prvom vykreslení", async () => {
    const profile = { version: 1, lawyerName: "Testovací advokát", jurisdiction: "cz", language: "cs" } as const;
    await withClientForm(async ({ render, inputValues }) => {
      // Bočný panel „Pridať klienta“: formulár sa vykreslí skôr, než sa načíta profil.
      await render({ ...profile, officeRoot: undefined });
      expect(inputValues()).not.toContain(FOLDER);
      await render({ ...profile, officeRoot: "/Users/advokat/Prax/Office" });
      expect(inputValues()).toContain(FOLDER);
    });
  });
});

describe("pripojenie existujúceho priečinka ostáva prísne", () => {
  const existing = { ...newClient, existing: true, value: "/Users/advokat/Stare/Novák", clientParent: "" };

  test("skúšobná kópia potrebuje miesto kópie a potvrdenie klienta", () => {
    expect(clientFormValid({ ...existing, mode: "trial_clone", confirmedClient: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "trial_clone", cloneParent: "/Users/advokat/Stare" })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "trial_clone", cloneParent: "/Users/advokat/Stare", confirmedClient: true })).toBe(true);
  });

  test("zápis do originálu potrebuje obe potvrdenia", () => {
    expect(clientFormValid({ ...existing, mode: "convert", confirmedClient: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "convert", confirmedWrite: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "convert", confirmedWrite: true, confirmedClient: true })).toBe(true);
  });

  test("mapovanie potrebuje pamäť a kotvu, potvrdenie klienta nie", () => {
    expect(clientFormValid({ ...existing, mode: "map", memoryPath: "pamat.md" })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "map", memoryPath: "pamat.md", identityAnchor: "Novák" })).toBe(true);
  });
});
