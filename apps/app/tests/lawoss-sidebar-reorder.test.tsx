import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { useSidebarReorderSpring } from "../src/lawoss/lite/sidebar-reorder";

// #242 (k N-A4-7): skupiny chatov a chaty v bočnom paneli sa posúvajú animáciou len počas ťahania, inak hneď.
const spring: { current?: ReturnType<typeof useSidebarReorderSpring> } = {};
function Probe() {
  const value = useSidebarReorderSpring();
  spring.current = value;
  return <span>{JSON.stringify(value.transition ?? null)}</span>;
}

describe("animácia polohy chatov v bočnom paneli", () => {
  test("mimo ťahania okamžitý posun, počas ťahania predvolená animácia, po ňom znova okamžitý", () => {
    expect(renderToStaticMarkup(<Probe />)).toContain(JSON.stringify({ layout: { type: false } }).replace(/"/g, "&quot;"));
    const dragged = spring.current;
    dragged?.onDragStart();
    dragged?.onDragStart(); // druhé začatie tej istej položky sa nepočíta
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>null</span>");
    dragged?.onDragEnd();
    expect(renderToStaticMarkup(<Probe />)).toContain("&quot;type&quot;:false");
  });
});
