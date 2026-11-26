import { parsePdfSignatures } from "./signature-parser";

self.onmessage = async (event: MessageEvent<Uint8Array>) => {
  self.postMessage(await parsePdfSignatures(event.data));
};
