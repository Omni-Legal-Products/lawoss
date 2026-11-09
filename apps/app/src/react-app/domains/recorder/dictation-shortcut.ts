import type { AudioSystemDictationPlatform } from "@legalwork/types/audio";

export function dictationAcceleratorFromEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  platform: AudioSystemDictationPlatform,
): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push(platform === "darwin" ? "Command" : "Super");

  let key = "";
  if (/^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  else if (/^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  else if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) key = event.key.toUpperCase();
  else {
    const namedKeys: Record<string, string> = {
      " ": "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Backspace: "Backspace",
      Delete: "Delete",
      Enter: "Enter",
      Tab: "Tab",
    };
    key = namedKeys[event.key] ?? (/^[\p{P}\p{S}]$/u.test(event.key) ? event.key : "");
    if (key === "+") key = "Plus";
  }
  if (!key || (modifiers.length === 0 && !key.startsWith("F"))) return null;
  return [...modifiers, key].join("+");
}

export function formatDictationShortcut(
  accelerator: string,
  platform: AudioSystemDictationPlatform,
): string {
  const parts = accelerator.split("+");
  if (platform === "darwin") {
    const symbols: Record<string, string> = {
      CommandOrControl: "⌘",
      Command: "⌘",
      Super: "⌘",
      Control: "⌃",
      Alt: "⌥",
      Shift: "⇧",
      Fn: "fn",
      Plus: "+",
    };
    return parts.map((part) => symbols[part] ?? part).join("");
  }
  const labels: Record<string, string> = {
    CommandOrControl: "Ctrl",
    Command: "Ctrl",
    Control: "Ctrl",
    Super: "Windows",
    Fn: "Fn",
    Plus: "+",
  };
  return parts.map((part) => labels[part] ?? part).join("+");
}
