import { createHash } from "node:crypto";

// Exact shipped SKILL.md bytes, checked against the real server bundles by regression tests.
// Update these only when the corresponding original bundled workflow changes.
const ORIGINALS = {
  "workflow-assistant-due-diligence": "19bb589e8c7677c2f5c5fe01251e3bd862ec97321779e3fa66af754aedc36293",
  "workflow-firm-knowledge": "cdef623146d2e38e72349e5a8bbc2e6384e465af29ead1c0097446afc0201054",
};

export function nativeBundledDisplayId(name, raw, global) {
  if (!global || !Object.hasOwn(ORIGINALS, name)) return undefined;
  return createHash("sha256").update(raw).digest("hex") === ORIGINALS[name] ? name : undefined;
}
