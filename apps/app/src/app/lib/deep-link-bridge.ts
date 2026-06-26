export const deepLinkBridgeEvent = "legalwork:deep-link";
export const nativeDeepLinkEvent = "legalwork:deep-link-native";

export type DeepLinkBridgeDetail = {
  urls: string[];
};

declare global {
  interface Window {
    __LEGALWORK__?: {
      deepLinks?: string[];
    };
  }
}

function normalizeDeepLinks(urls: readonly string[]): string[] {
  return urls.flatMap((url) => {
    const trimmed = url.trim();
    return trimmed ? [trimmed] : [];
  });
}

export function pushPendingDeepLinks(target: Window, urls: readonly string[]): string[] {
  const normalized = normalizeDeepLinks(urls);
  if (normalized.length === 0) {
    return [];
  }

  target.__LEGALWORK__ ??= {};
  const pending = target.__LEGALWORK__.deepLinks ?? [];
  target.__LEGALWORK__.deepLinks = [...pending, ...normalized];
  target.dispatchEvent(
    new CustomEvent<DeepLinkBridgeDetail>(deepLinkBridgeEvent, {
      detail: { urls: normalized },
    }),
  );
  return normalized;
}

export function drainPendingDeepLinks(target: Window): string[] {
  const pending = target.__LEGALWORK__?.deepLinks ?? [];
  if (target.__LEGALWORK__) {
    target.__LEGALWORK__.deepLinks = [];
  }
  return [...pending];
}
