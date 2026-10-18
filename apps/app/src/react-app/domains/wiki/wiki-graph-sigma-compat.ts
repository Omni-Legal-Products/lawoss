import { LabelProgram } from "sigma/rendering";

/**
 * Sigma 4.0.0 sends its non-pickable glyph shader through a picking pass. That
 * shader only discards, so ANGLE removes its color output and rejects the draw.
 * Label hitboxes use separate programs and retain their normal picking pass.
 */
export function disableSigmaGlyphPicking(): void {
  // This base class currently inherits render. A future own implementation, or
  // an earlier invocation during hot reload, must not be wrapped again.
  if (Object.hasOwn(LabelProgram.prototype, "render")) return;
  const render = LabelProgram.prototype.render;
  LabelProgram.prototype.render = function (params, offset, count) {
    render.call(this, { ...params, pickingFrameBuffer: null }, offset, count);
  };
}
