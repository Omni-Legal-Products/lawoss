/**
 * LAWOSS: app-owned fields kept in a runtime config row next to the native V2 engine configuration.
 * The native decoder rejects unknown keys (`onExcessProperty: "error"`), so these must be classified
 * as application keys before the row is decoded or upgraded from a v1 row (runtime-config-upgrade.ts).
 * They never reach the engine.
 */
export const LAWOSS_APPLICATION_KEYS = ["guidanceAck", "aiPreference", "aiBoundaries", "lawossYolo", "ollamaChatRepairIDs"] as const;
