import { createContext, useContext, type ReactNode } from "react";
import type { ViewOwner } from "@legalwork/types/views";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

export type ViewHost = { client: LegalworkServerClient | null; owner: ViewOwner; openSource?: (path: string) => void };
const Context = createContext<ViewHost | null>(null);
export function ViewHostProvider({ children, ...host }: ViewHost & { children: ReactNode }) { return <Context.Provider value={host}>{children}</Context.Provider>; }
export function useViewHost() { return useContext(Context); }
