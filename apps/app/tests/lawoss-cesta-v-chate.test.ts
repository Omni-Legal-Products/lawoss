import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { clientFirstLineFileParts, clientPathScope } from "../src/lawoss/chat/prompt-file-parts";
import { firstLineLocalFileParts } from "../src/react-app/domains/session/sync/prompt-file-parts";

// N-A7-13: cesta v prvom riadku správy je príloha len v priečinku klienta, inak obyčajný text.
const ROOT = "/Users/advokat/Prax/Klienti/C001-SYN-Tatran";
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

// Ako v Electrone: platforma a userAgent (Windows sa rozpozná podľa „Windows NT“ v userAgent).
const AGENTS = { MacIntel: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", Win32: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Linux x86_64": "Mozilla/5.0 (X11; Linux x86_64)" };
function platform(name: keyof typeof AGENTS) {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { platform: name, userAgent: AGENTS[name] } });
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

const urls = (text: string, root = ROOT, clientRoot?: string, registeredRoots?: string[]) =>
  clientFirstLineFileParts(text, root, clientRoot === undefined ? undefined : { root: clientRoot, registeredRoots }).map((part) => part.url);

describe("cesta v chate klienta", () => {
  test("cesta v priečinku klienta sa pripojí ako doteraz", () => {
    platform("Linux x86_64");
    const text = `Pozri ${ROOT}/Spisy/M001/zmluva.pdf.`;
    expect(clientFirstLineFileParts(text, ROOT)).toEqual(firstLineLocalFileParts(text, ROOT));
    expect(urls(text)).toEqual([`file://${ROOT}/Spisy/M001/zmluva.pdf`]);
    expect(urls(`Pozri file://${ROOT}/Spisy/M001/zmluva%20nova.pdf`)).toEqual([`file://${ROOT}/Spisy/M001/zmluva%20nova.pdf`]);
    expect(urls(`Pozri ${ROOT}/`)).toEqual([`file://${ROOT}/`]);
  });

  test("~/Documents a iné cesty mimo klienta ostanú textom", () => {
    platform("MacIntel");
    // Upstream z ~/Documents spravil prílohu domovského priečinka.
    expect(firstLineLocalFileParts("Pozri sa, čo je v ~/Documents.", ROOT)).toHaveLength(1);
    expect(urls("Pozri sa, čo je v ~/Documents.")).toEqual([]);
    expect(urls("Pozri file:///Users/advokat/Documents")).toEqual([]);
    expect(urls("Pozri /Users/advokat/Prax/Klienti/C002-SYN-Hron/zmluva.pdf")).toEqual([]);
    expect(urls("Pozri /Users/advokat/Prax/Klienti")).toEqual([]);
    expect(urls("Pozri /etc/hosts")).toEqual([]);
  });

  test("~/ sa pripojí, len keď vyjde do priečinka klienta", () => {
    platform("Linux x86_64");
    expect(urls("Pozri ~/Prax/Klienti/C001-SYN-Tatran/Spisy/M001/zmluva.pdf")).toEqual([`file://${ROOT}/Spisy/M001/zmluva.pdf`]);
    expect(urls("Pozri ~/Prax/Klienti/C002-SYN-Hron/zmluva.pdf")).toEqual([]);
  });

  test("segment .. nikdy nepripojí, ani keď by ostal v klientovi", () => {
    platform("Linux x86_64");
    expect(urls(`Pozri ${ROOT}/../C002-SYN-Hron/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/Spisy/../../../../../Documents`)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/Spisy/../Spisy/M001/zmluva.pdf`)).toEqual([]);
    expect(urls("Pozri ~/Prax/Klienti/C001-SYN-Tatran/../C002-SYN-Hron/zmluva.pdf")).toEqual([]);
    // file:// URL normalizuje .. ešte pred kontrolou; výsledok mimo klienta sa nepripojí.
    expect(urls(`Pozri file://${ROOT}/%2E%2E/C002-SYN-Hron/zmluva.pdf`)).toEqual([]);
  });

  test("prefix: /…/C001-SYN-Tatran nepustí /…/C001-SYN-Tatran-2", () => {
    platform("MacIntel");
    expect(urls(`Pozri ${ROOT}-2/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri ${ROOT}2/zmluva.pdf`)).toEqual([]);
    expect(urls("Pozri /users/advokat/prax/klienti/c001-syn-tatran-2/zmluva.pdf")).toEqual([]);
  });

  test("veľkosť písmen: macOS a Windows bez rozdielu, Linux presne", () => {
    platform("MacIntel");
    expect(urls("Pozri /users/ADVOKAT/prax/klienti/c001-syn-tatran/zmluva.pdf")).toHaveLength(1);
    platform("Linux x86_64");
    expect(urls("Pozri /users/ADVOKAT/prax/klienti/c001-syn-tatran/zmluva.pdf")).toEqual([]);

    platform("Win32");
    const win = "C:\\Prax\\Klienti\\C001-SYN-Tatran";
    expect(urls("Pozri C:\\Prax\\Klienti\\C001-SYN-Tatran\\Spisy\\zmluva.docx", win)).toEqual(["file:///C:/Prax/Klienti/C001-SYN-Tatran/Spisy/zmluva.docx"]);
    expect(urls("Pozri c:/prax/klienti/c001-syn-tatran/zmluva.docx", win)).toHaveLength(1);
    expect(urls("Pozri C:\\Users\\advokat\\Documents\\zmluva.docx", win)).toEqual([]);
    expect(urls("Pozri C:\\Prax\\Klienti\\C001-SYN-Tatran-2\\zmluva.docx", win)).toEqual([]);
    expect(urls("Pozri C:\\Prax\\Klienti\\C001-SYN-Tatran\\..\\C002-SYN-Hron\\zmluva.docx", win)).toEqual([]);
  });

  test("chat prípadu porovnáva s koreňom klienta; bez koreňa sa nepripojí nič", () => {
    platform("Linux x86_64");
    const caseFolder = `${ROOT}/Spisy/M001`;
    expect(urls(`Pozri ${ROOT}/_STATUS.md`, caseFolder, ROOT)).toEqual([`file://${ROOT}/_STATUS.md`]);
    expect(urls("Pozri /Users/advokat/Prax/Klienti/C002-SYN-Hron/zmluva.pdf", caseFolder, ROOT)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/zmluva.pdf`, "")).toEqual([]);
    expect(urls(`Pozri ${ROOT}/zmluva.pdf`, ROOT, "  ")).toEqual([]);
  });

  test("vnorený registrovaný klient a koreň praxe: nič z cudzieho klienta", () => {
    platform("Linux x86_64");
    const practice = "/Users/advokat/Prax/Klienti";
    const nested = `${ROOT}/Dcera-C003-SYN-Lipa`;
    const hron = `${practice}/C002-SYN-Hron`;
    const registered = [practice, ROOT, nested, hron];
    // Scenár A: chat C001 obsahuje registrovaného klienta C003; súbor C003 sa nepripojí.
    expect(urls(`Pozri ${nested}/zmluva.pdf`, ROOT, ROOT, registered)).toEqual([]);
    expect(urls(`Pozri ${nested}/zmluva.pdf`, ROOT, ROOT, [ROOT, nested])).toEqual([]);
    // Scenár B: chat registrovaného koreňa praxe nepripojí súbor klienta ani vlastný súbor.
    expect(urls(`Pozri ${hron}/zmluva.pdf`, practice, practice, registered)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/zmluva.pdf`, practice, practice, registered)).toEqual([]);
    expect(urls(`Pozri ${practice}/Office/sablona.docx`, practice, practice, registered)).toEqual([]);
    // Chat vnoreného C003 a chat C002: vlastný súbor áno, iný klient nie; nadradená prax nevadí.
    expect(urls(`Pozri ${nested}/zmluva.pdf`, nested, nested, registered)).toEqual([`file://${nested}/zmluva.pdf`]);
    expect(urls(`Pozri ${hron}/zmluva.pdf`, hron, hron, registered)).toEqual([`file://${hron}/zmluva.pdf`]);
    expect(urls(`Pozri ${ROOT}/zmluva.pdf`, hron, hron, registered)).toEqual([]);
    // Rovnaký koreň zapísaný inak (koncová lomka) nie je iný klient.
    expect(urls(`Pozri ${hron}/zmluva.pdf`, hron, hron, [`${hron}/`, practice])).toHaveLength(1);
  });

  test("clientPathScope: koreň registrovaného klienta chatu, inak priečinok chatu", () => {
    const workspaces = [{ id: "c001", path: ` ${ROOT} ` }, { id: "c002", path: "/Users/advokat/Prax/Klienti/C002-SYN-Hron" }, { id: "x", path: null }];
    expect(clientPathScope(workspaces, "c001", `${ROOT}/Spisy/M001`)).toEqual({ root: ROOT, registeredRoots: [ROOT, "/Users/advokat/Prax/Klienti/C002-SYN-Hron"] });
    expect(clientPathScope(workspaces, "nie", "/iny")).toEqual({ root: "/iny", registeredRoots: [ROOT, "/Users/advokat/Prax/Klienti/C002-SYN-Hron"] });
  });

  test("Windows: file:///C:/… v klientovi sa pripojí, mimo klienta nie", () => {
    platform("Win32");
    const win = "C:\\Prax\\Klienti\\C001-SYN-Tatran";
    expect(urls("Pozri file:///C:/Prax/Klienti/C001-SYN-Tatran/Spisy/zmluva.docx", win)).toEqual(["file:///C:/Prax/Klienti/C001-SYN-Tatran/Spisy/zmluva.docx"]);
    expect(urls("Pozri file:///c:/prax/klienti/c001-syn-tatran/zmluva.docx", win)).toEqual(["file:///c:/prax/klienti/c001-syn-tatran/zmluva.docx"]);
    expect(urls("Pozri file:///C:/Users/advokat/Documents", win)).toEqual([]);
    expect(urls("Pozri file:///C:/Prax/Klienti/C001-SYN-Tatran-2/zmluva.docx", win)).toEqual([]);
    expect(urls("Pozri file:///D:/Prax/Klienti/C001-SYN-Tatran/zmluva.docx", win)).toEqual([]);
  });

  test("dvojité kódovanie: %2e, %2f a %5c po dekódovaní sa nepripoja", () => {
    platform("Linux x86_64");
    expect(urls(`Pozri file://${ROOT}/%252e%252e/C002-SYN-Hron/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri file://${ROOT}/Spisy%252F..%252F..%252FC002/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri file://${ROOT}/Spisy%255c..%255cC002/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/%2E%2E/C002-SYN-Hron/zmluva.pdf`)).toEqual([]);
    expect(urls(`Pozri ${ROOT}/Spisy/zmluva%20nova.pdf`)).toHaveLength(1);
  });

  test("odoslanie správy volá len verziu obmedzenú na klienta", () => {
    for (const file of ["../src/react-app/shell/session-route.tsx", "../src/react-app/domains/session/sync/actions-store.ts"]) {
      const source = readFileSync(resolve(import.meta.dir, file), "utf8");
      expect(source).not.toContain("firstLineLocalFileParts(");
      expect(source).toContain("clientFirstLineFileParts(");
    }
  });
});
