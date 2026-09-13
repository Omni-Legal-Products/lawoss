import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { guardNavigation, isAllowedNavigation } from "./window-allowlist.mjs";

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

function fakeContents() {
  const stops = [];
  const contents = Object.assign(new EventEmitter(), { stop: () => { stops.push(true); } });
  return { contents, stops };
}

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

  it("did-start-navigation mimo allowlistu zastaví načítanie (CDP Page.navigate), okrem in-page navigácie", () => {
    const { contents, stops } = fakeContents();
    const blocked = [];
    guardNavigation(contents, DEV, (url) => blocked.push(url));

    contents.emit("did-start-navigation", navigationEvent("http://localhost:5174/transfers/0361bbfc"));
    contents.emit("did-start-navigation", navigationEvent("http://localhost:5174/", true, true));

    assert.deepEqual(stops, [true]);
    assert.deepEqual(blocked, ["http://localhost:5174/transfers/0361bbfc"]);
  });
});
