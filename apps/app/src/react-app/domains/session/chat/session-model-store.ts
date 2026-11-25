import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ModelRef } from "@/app/types";

export type ChatModelSelection = { model: ModelRef; variant: string | null };
export const chatModelKey = (baseUrl: string, workspaceId: string, sessionId: string) => JSON.stringify([baseUrl, workspaceId, sessionId]);
export const useSessionModelStore = create(persist<{
  selections: Record<string, ChatModelSelection>;
  speedByChat: Record<string, { base: string; fast: boolean }>;
  setSpeed: (key: string, base: string, fast: boolean) => void;
  initialize: (key: string, selection: ChatModelSelection) => void;
  select: (key: string, selection: ChatModelSelection) => void;
}>((set) => ({
  selections: {},
  speedByChat: {},
  setSpeed: (key, base, fast) => set(state => ({ speedByChat: { ...state.speedByChat, [key]: { base, fast } } })),
  initialize: (key, selection) => set(state => state.selections[key] ? state : { selections: { ...state.selections, [key]: selection } }),
  select: (key, selection) => set(state => ({ selections: { ...state.selections, [key]: selection } })),
}), { name: "legalwork.chat-models.v1" }));
