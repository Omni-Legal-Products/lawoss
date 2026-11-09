import type { AudioDictationPermissionKind, AudioDictationPermissionState, AudioDictationReadiness } from "@legalwork/types/audio";

export type DictationSetupPermission = Exclude<AudioDictationPermissionKind, "microphone">;
export const dictationSetupPermissions: readonly DictationSetupPermission[] = ["inputMonitoring", "accessibility", "automation"];

export function dictationPermissionReady(state: AudioDictationPermissionState): boolean {
  return state !== "denied" && state !== "broken" && state !== "not-determined";
}

export function dictationPermissionsReady(readiness: AudioDictationReadiness | null): boolean {
  return readiness !== null && dictationSetupPermissions.every(kind => dictationPermissionReady(readiness[kind]));
}

export function onboardingDictationPermissions(readiness: AudioDictationReadiness | null): DictationSetupPermission[] {
  if (readiness?.platform !== "darwin") return [];
  return dictationSetupPermissions.filter(kind => readiness[kind] !== "unavailable" && readiness[kind] !== "not-required");
}
