import { expect, spyOn, test } from "bun:test";
import type { RenderParams } from "sigma/types";

test("Sigma glyph draws skip invalid picking while node and label-hitbox programs retain it", async () => {
  // Sigma reads these standard enum values at module initialization. No GL calls
  // are stubbed: this test intercepts only the program dispatch boundary.
  const originalContext = Object.getOwnPropertyDescriptor(globalThis, "WebGL2RenderingContext");
  if (!originalContext) Object.defineProperty(globalThis, "WebGL2RenderingContext", { configurable: true, value: { BOOL: 0x8B56, BYTE: 0x1400, UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, UNSIGNED_INT: 0x1405, FLOAT: 0x1406 } });
  const { LabelProgram, Program } = await import("sigma/rendering");
  const { disableSigmaGlyphPicking } = await import("../src/react-app/domains/wiki/wiki-graph-sigma-compat");
  const framebuffer: WebGLFramebuffer = {};
  const params: RenderParams = {
    frameId: 1, width: 800, height: 600, sizeRatio: 1, zoomRatio: 1, pixelRatio: 2,
    cameraAngle: 0, correctionRatio: 1, matrix: new Float32Array(9), invMatrix: new Float32Array(9),
    downSizingRatio: 2, minEdgeThickness: 1, antiAliasingFeather: 1, nodePickingPadding: 5,
    edgePickingPadding: 0, labelPickingPadding: 2, nodeDataTextureUnit: 0, nodeDataTextureWidth: 1,
    nodeFrameTextureUnit: 1, nodeFrameTextureWidth: 1, edgeDataTextureUnit: 2, edgeDataTextureWidth: 1,
    edgeFrameTextureUnit: 3, edgeFrameTextureWidth: 1, pickingFrameBuffer: framebuffer, labelPixelSnapping: 1,
  };
  const draws: { params: RenderParams; offset?: number; count?: number }[] = [];
  const render = spyOn(Program.prototype, "render").mockImplementation((params, offset, count) => { draws.push({ params, offset, count }); });
  try {
    disableSigmaGlyphPicking();
    const first = LabelProgram.prototype.render;
    disableSigmaGlyphPicking();
    expect(LabelProgram.prototype.render).toBe(first);

    // Exercise the real inheritance boundary without creating a browser GPU.
    const glyph: unknown = Object.create(LabelProgram.prototype);
    const hitbox: unknown = Object.create(Program.prototype);
    if (!(glyph instanceof LabelProgram) || !(hitbox instanceof Program)) throw new Error("Invalid test program");
    glyph.render(params, 3, 7);
    hitbox.render(params, 4, 8);
    expect(draws).toEqual([
      { params: { ...params, pickingFrameBuffer: null }, offset: 3, count: 7 },
      { params, offset: 4, count: 8 },
    ]);
    expect(params.pickingFrameBuffer).toBe(framebuffer);
    expect(draws[1].params.pickingFrameBuffer).toBe(framebuffer);
  } finally {
    Reflect.deleteProperty(LabelProgram.prototype, "render");
    render.mockRestore();
    if (!originalContext) Reflect.deleteProperty(globalThis, "WebGL2RenderingContext");
  }
});
