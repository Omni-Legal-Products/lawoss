import { afterEach, expect, test } from "bun:test";
import type { AudioRecorderBootstrap } from "@legalwork/types/audio";
import { isCloudTranscriptionHidden } from "../src/lawoss/feature-flags";
import { useRecorderStore } from "../src/react-app/domains/recorder/recorder-store";

// 🟡 LAWOSS (MČ 8. 11. 2026): Gemini cloud transcription is not offered in the UI.
const previous = useRecorderStore.getState();
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const bootstrap: AudioRecorderBootstrap = {
  models: [], capabilities: { microphone: true, systemAudio: true, appAudio: false }, engine: { available: true, error: null },
  diarization: { installed: false, downloading: false, downloadedBytes: 0, totalBytes: 0, error: null },
  device: { totalMemoryGb: 16, logicalCores: 8, appleSilicon: true, fastDevice: true, recommendedModelId: "whisper-small" },
  cloud: { models: [{ model: "gemini-transcribe-live-eu", name: "Gemini", region: "EU", enabled: true, available: true }], error: null },
  modelsDir: "", recordingsDir: "",
};
afterEach(() => {
  useRecorderStore.setState(previous, true);
  if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
  else Reflect.deleteProperty(globalThis, "window");
});

test("cloud transcription models never reach the recorder state and cannot be selected", async () => {
  expect(isCloudTranscriptionHidden()).toBe(true);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { __LEGALWORK_ELECTRON__: {
    invokeDesktop: async (command: string) => (command === "audioRecorderBootstrap" ? bootstrap : null),
  } } });
  useRecorderStore.setState({ prewarm: async () => {} });
  await useRecorderStore.getState().refreshBootstrap();
  expect(useRecorderStore.getState().bootstrap?.cloud).toBeUndefined();
  useRecorderStore.setState({ bootstrap });
  useRecorderStore.getState().setTranscriptionSource("cloud", "gemini-transcribe-live-eu");
  expect(useRecorderStore.getState().transcriptionSource).toBe("local");
});
