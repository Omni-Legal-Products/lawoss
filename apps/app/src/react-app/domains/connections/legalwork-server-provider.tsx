/** @jsxImportSource react */
import {
  createContext,
  use,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { LegalworkServerStore } from "./legalwork-server-store";

const LegalworkServerContext = createContext<LegalworkServerStore | null>(null);

export function LegalworkServerProvider(props: {
  store: LegalworkServerStore;
  children: ReactNode;
}) {
  return (
    <LegalworkServerContext.Provider value={props.store}>
      {props.children}
    </LegalworkServerContext.Provider>
  );
}

export function useLegalworkServer() {
  const store = use(LegalworkServerContext);
  if (!store) {
    throw new Error("useLegalworkServer must be used within an LegalworkServerProvider");
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
