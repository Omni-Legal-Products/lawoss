import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describeBlockedUrl, guardNavigation, isAllowedNavigation, originAllowlistEntry } from "./window-allowlist.mjs";

const DEV = ["file:", "data:", "http://localhost:5173"];
const PACKAGED = ["file:", "data:"];

describe("isAllowedNavigation", () => {
  it("pustí vlastný dev origin, file:// bundle a data: obrazovku", () => {
    assert.equal(isAllowedNavigation("http://localhost:5173/", DEV), true);
    assert.equal(isAllowedNavigation("http://localhost:5173/#/workspace/w1/session/s1", DEV), true);
    assert.equal(isAllowedNavigation("file:///Applications/LAWOSS.app/Contents/Resources/app-dist/index.html", DEV), true);
    assert.equal(isAllowedNavigation("data:text/html;charset=utf-8,%3Cp%3Ehi%3C%2Fp%3E", DEV), true);
  });

  it("zablokuje cudziu localhost adresu na inom porte (#47)", () => {
    assert.equal(isAllowedNavigation("http://localhost:5174/transfers/0361bbfc", DEV), false);
    assert.equal(isAllowedNavigation("http://127.0.0.1:9823/json/list", DEV), false);
    assert.equal(isAllowedNavigation("http://localhost:5174/", PACKAGED), false);
    assert.equal(isAllowedNavigation("http://localhost:5173/", PACKAGED), false);
  });

  it("origin porovnáva presne, nie prefixom ani podľa hostiteľa", () => {
    assert.equal(isAllowedNavigation("http://localhost:51730/", DEV), false);
    assert.equal(isAllowedNavigation("http://localhost:5173.evil.test/", DEV), false);
    assert.equal(isAllowedNavigation("https://localhost:5173/", DEV), false);
    assert.equal(isAllowedNavigation("http://127.0.0.1:5173/", DEV), false);
  });

  it("odmietne cudzie schémy a nezmyselné vstupy", () => {
    assert.equal(isAllowedNavigation("https://example.test/", DEV), false);
    assert.equal(isAllowedNavigation("javascript:alert(1)", DEV), false);
    assert.equal(isAllowedNavigation("about:blank", DEV), false);
    assert.equal(isAllowedNavigation("nie je url", DEV), false);
    assert.equal(isAllowedNavigation("", DEV), false);
  });
});

describe("originAllowlistEntry", () => {
  it("z http(s) štartovacej adresy spraví presný origin", () => {
    assert.deepEqual(originAllowlistEntry("http://localhost:5173/"), ["http://localhost:5173"]);
    assert.deepEqual(originAllowlistEntry("https://127.0.0.1:8443/app/index.html?x=1"), ["https://127.0.0.1:8443"]);
  });

  it("nepriehľadný origin sa nikdy nestane položkou allowlistu", () => {
    // `new URL("file:///…").origin` je reťazec "null" a ten istý "null" má aj
    // `javascript:` — ako položka allowlistu by pustil `window.open("javascript:…")`
    // do okna s naším preloadom.
    for (const url of ["file:///Applications/LAWOSS.app/Contents/Resources/app-dist/index.html", "data:text/html,x", "about:blank", "javascript:alert(1)"]) {
      assert.deepEqual(originAllowlistEntry(url), []);
    }
    assert.equal(isAllowedNavigation("javascript:alert(1)", [...PACKAGED, ...originAllowlistEntry("file:///a/index.html")]), false);
  });

  it("prázdna ani nezmyselná adresa nezhodí štart aplikácie", () => {
    assert.deepEqual(originAllowlistEntry(undefined), []);
    assert.deepEqual(originAllowlistEntry(""), []);
    assert.deepEqual(originAllowlistEntry("nie je url"), []);
  });
});

describe("describeBlockedUrl", () => {
  it("do logu ide schéma, hostiteľ a cesta — nikdy dotaz ani fragment", () => {
    assert.equal(
      describeBlockedUrl("https://example.test/login?token=tajne#kod"),
      "https://example.test/login",
    );
    assert.equal(describeBlockedUrl("http://localhost:5174/transfers/0361bbfc"), "http://localhost:5174/transfers/0361bbfc");
    assert.equal(describeBlockedUrl("data:text/html,%3Cscript%3E"), "data:…");
    assert.equal(describeBlockedUrl("nie je url"), "(neplatná adresa)");
  });
});

function fakeContents() {
  const stops = [];
  const contents = Object.assign(new EventEmitter(), {
    destroyed: false,
    stop: () => { stops.push(true); },
    isDestroyed: () => contents.destroyed,
  });
  return { contents, stops };
}

const nextLoopTurn = () => new Promise((resolve) => setImmediate(resolve));

function navigationEvent(url, isMainFrame = true, isSameDocument = false) {
  const event = { url, isMainFrame, isSameDocument, prevented: false, preventDefault: () => { event.prevented = true; } };
  return event;
}

describe("guardNavigation", () => {
  it("zruší will-navigate a will-redirect mimo allowlistu a ohlási ich", () => {
    const { contents } = fakeContents();
    const blocked = [];
    guardNavigation(contents, DEV, (url) => blocked.push(url));

    const navigate = navigationEvent("http://localhost:5174/");
    contents.emit("will-navigate", navigate);
    const redirect = navigationEvent("https://example.test/login");
    contents.emit("will-redirect", redirect);

    assert.equal(navigate.prevented, true);
    assert.equal(redirect.prevented, true);
    assert.deepEqual(blocked, ["http://localhost:5174/", "https://example.test/login"]);
  });

  it("nechá prejsť navigáciu na vlastný origin a v iframe", () => {
    const { contents, stops } = fakeContents();
    const blocked = [];
    guardNavigation(contents, DEV, (url) => blocked.push(url));

    const own = navigationEvent("http://localhost:5173/#/settings");
    contents.emit("will-navigate", own);
    const iframe = navigationEvent("https://example.test/pdf", false);
    contents.emit("will-redirect", iframe);
    contents.emit("did-start-navigation", navigationEvent("http://localhost:5173/", true));
    contents.emit("did-start-navigation", navigationEvent("https://example.test/", false));

    assert.equal(own.prevented, false);
    assert.equal(iframe.prevented, false);
    assert.deepEqual(blocked, []);
    assert.deepEqual(stops, []);
  });

  it("did-start-navigation mimo allowlistu zastaví načítanie (CDP Page.navigate), okrem in-page navigácie", async () => {
    const { contents, stops } = fakeContents();
    const blocked = [];
    guardNavigation(contents, DEV, (url) => blocked.push(url));

    contents.emit("did-start-navigation", navigationEvent("http://localhost:5174/transfers/0361bbfc"));
    contents.emit("did-start-navigation", navigationEvent("http://localhost:5174/", true, true));
    await nextLoopTurn();

    assert.deepEqual(stops, [true]);
    assert.deepEqual(blocked, ["http://localhost:5174/transfers/0361bbfc"]);
  });

  it("stop() nevolá počas did-start-navigation, Electron 43 by na tom spadol (SIGTRAP)", async () => {
    const { contents, stops } = fakeContents();
    guardNavigation(contents, DEV, () => {});

    contents.emit("did-start-navigation", navigationEvent("https://example.test/"));
    assert.deepEqual(stops, []);

    await nextLoopTurn();
    assert.deepEqual(stops, [true]);
  });

  it("odložený stop() vynechá zničený WebContents", async () => {
    const { contents, stops } = fakeContents();
    const blocked = [];
    guardNavigation(contents, DEV, (url) => blocked.push(url));

    contents.emit("did-start-navigation", navigationEvent("https://example.test/"));
    contents.destroyed = true;
    await nextLoopTurn();

    assert.deepEqual(stops, []);
    assert.deepEqual(blocked, ["https://example.test/"]);
  });
});


describe("upstream app URL matcher integration", () => {
  it("rejects file and data documents outside the app while preserving redirects and CDP guards", async () => {
    const { createAppUrlMatcher } = await import("./app-url.mjs");
    const isTrusted = createAppUrlMatcher({ appRoot: "/tmp/lawoss-app" });
    const { contents, stops } = fakeContents();
    const blocked = [];
    guardNavigation(contents, ["file:", "data:"], url => blocked.push(url), isTrusted);
    const own = navigationEvent("file:///tmp/lawoss-app/index.html#/home");
    contents.emit("will-navigate", own);
    assert.equal(own.prevented, false);
    for (const url of ["file:///tmp/foreign.html", "data:text/html,foreign", "http://localhost:5174/"]) {
      const redirect = navigationEvent(url);
      contents.emit("will-redirect", redirect);
      assert.equal(redirect.prevented, true);
      contents.emit("did-start-navigation", navigationEvent(url));
    }
    await nextLoopTurn();
    assert.equal(stops.length, 3);
    assert.equal(blocked.length, 6);
  });
});
