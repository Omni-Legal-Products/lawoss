import { expect, test } from "bun:test";
import { dictationAcceleratorFromEvent, formatDictationShortcut } from "../src/react-app/domains/recorder/dictation-shortcut";

const control = { ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };

test("captures Ctrl+< on ISO keyboards without depending on the browser's physical key code", () => {
  for (const code of ["IntlBackslash", "Backquote"]) {
    const accelerator = dictationAcceleratorFromEvent({ ...control, key: "<", code }, "darwin");
    expect(accelerator).toBe("Control+<");
    expect(formatDictationShortcut(accelerator!, "darwin")).toBe("⌃<");
    expect(formatDictationShortcut(accelerator!, "windows")).toBe("Ctrl+<");
  }
});

test("captures shifted punctuation and encodes the plus key without confusing the chord separator", () => {
  expect(dictationAcceleratorFromEvent({ ...control, shiftKey: true, key: ">", code: "IntlBackslash" }, "darwin")).toBe("Control+Shift+>");
  expect(dictationAcceleratorFromEvent({ ...control, key: "+", code: "BracketRight" }, "darwin")).toBe("Control+Plus");
  expect(formatDictationShortcut("Control+Plus", "darwin")).toBe("⌃+");
});

test("keeps existing letter, function and named shortcuts and ignores incomplete input", () => {
  expect(dictationAcceleratorFromEvent({ ...control, key: "d", code: "KeyD" }, "darwin")).toBe("Control+D");
  expect(dictationAcceleratorFromEvent({ ...control, key: "ArrowLeft", code: "ArrowLeft" }, "darwin")).toBe("Control+Left");
  expect(dictationAcceleratorFromEvent({ ...control, ctrlKey: false, key: "F8", code: "F8" }, "darwin")).toBe("F8");
  for (const key of ["Control", "Shift", "Alt", "Meta", "Dead", "Unidentified"]) {
    expect(dictationAcceleratorFromEvent({ ...control, key, code: key }, "darwin")).toBeNull();
  }
  expect(dictationAcceleratorFromEvent({ ...control, ctrlKey: false, key: "<", code: "IntlBackslash" }, "darwin")).toBeNull();
});
