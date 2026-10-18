type SkippedSkill = { path: string; reason: string };

const STORAGE_KEY = "legalwork.skills.skippedErrors.v1";

export function createSkippedSkillsTracker(storage?: Pick<Storage, "getItem" | "setItem">) {
  const seenBySource = new Map<string, Set<string>>();
  try {
    storage ??= typeof window === "undefined" ? undefined : window.localStorage;
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(saved)) {
      for (const entry of saved) {
        if (!Array.isArray(entry) || typeof entry[0] !== "string" || !Array.isArray(entry[1])) continue;
        const errors = new Set<string>();
        for (const key of entry[1]) {
          if (typeof key === "string") errors.add(key);
        }
        if (errors.size) seenBySource.set(entry[0], errors);
      }
    }
  } catch {
    // Unavailable storage or invalid saved data must not block loading skills.
  }

  return (source: string, skipped: SkippedSkill[]): SkippedSkill[] => {
    const previous = seenBySource.get(source);
    const current = new Set<string>();
    const newlySkipped: SkippedSkill[] = [];

    for (const item of skipped) {
      const key = JSON.stringify([item.path, item.reason]);
      if (!current.has(key) && !previous?.has(key)) newlySkipped.push(item);
      current.add(key);
    }

    if (current.size) seenBySource.set(source, current);
    else seenBySource.delete(source);

    if (newlySkipped.length || current.size !== (previous?.size ?? 0)) {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...seenBySource].map(([source, errors]) => [source, [...errors]])));
      } catch {
        // Keep suppressing repeats in this session if persistence is unavailable.
      }
    }
    return newlySkipped;
  };
}
