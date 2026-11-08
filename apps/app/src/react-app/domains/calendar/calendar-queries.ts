import { useEffect } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { onSyncPoke } from "../../kernel/sync-events";
import { connectedCalendars, connectedCalendarEvents, type ConnectedCalendar } from "./connected-calendars";

export type CalendarSource = { id: string; name: string; workspaceId: string; client: LegalworkServerClient };
export type CalendarContext = { client: LegalworkServerClient | null; workspaceId?: string; remoteSources?: CalendarSource[] };

export function useCalendarRefresh() {
  const cache = useQueryClient();
  useEffect(() => onSyncPoke(poke => {
    if (poke.resync || poke.projects || poke.tasks || poke.policy || poke.hub || poke.sessions || poke.approvals || poke.reload) {
      void cache.invalidateQueries({ queryKey: ["calendar"] });
    }
  }), [cache]);
  return () => { void cache.invalidateQueries({ queryKey: ["calendar"] }); };
}

export function useCalendarOccurrences(context: CalendarContext, from: string, to: string) {
  const { client, workspaceId } = context;
  const sources = workspaceId ? [] : context.remoteSources ?? [];
  return useQuery({
    queryKey: ["calendar", client?.baseUrl, workspaceId ?? "all", sources.map(source => `${source.id}:${source.client.baseUrl}:${source.workspaceId}`).join(","), from, to],
    enabled: Boolean(client),
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!client) return { occurrences: [], unavailable: [] };
      const responses = await Promise.allSettled([client.calendarOccurrences(workspaceId ?? null, from, to), ...sources.map(source => source.client.calendarOccurrences(source.workspaceId, from, to))]);
      const local = responses[0];
      if (local.status === "rejected") throw local.reason;
      const occurrences = [...local.value.occurrences], unavailable: string[] = [];
      responses.slice(1).forEach((response, index) => {
        const source = sources[index];
        if (response.status === "rejected") { unavailable.push(source.name); return; }
        occurrences.push(...response.value.occurrences.map(item => ({ ...item, id: `${source.id}:${item.id}`, projectId: source.id, projectName: source.name })));
      });
      return { occurrences: occurrences.sort((a, b) => a.start.localeCompare(b.start)), unavailable };
    },
  });
}

export function useCalendarRecords({ client, workspaceId }: CalendarContext) {
  return useQuery({
    queryKey: ["calendar", client?.baseUrl, workspaceId, "items"],
    enabled: Boolean(client && workspaceId),
    queryFn: () => client && workspaceId ? client.calendarItems(workspaceId, true) : { items: [], conflicts: [] },
    refetchInterval: 60_000,
  });
}

export function useConnectedCalendars(client: LegalworkServerClient | null) {
  return useQuery({
    queryKey: ["calendar", client?.baseUrl, "connections"], enabled: Boolean(client),
    queryFn: () => client ? connectedCalendars(client) : { calendars: [], unavailable: [] },
    staleTime: 60_000, refetchInterval: 60_000, retry: false,
  });
}

export function useConnectedCalendarEvents(client: LegalworkServerClient | null, calendars: ConnectedCalendar[], from: string, to: string) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return useQueries({ queries: calendars.map(calendar => ({
    queryKey: ["calendar", client?.baseUrl, "connected-events", calendar.key, from, to, timeZone],
    enabled: Boolean(client), queryFn: () => client ? connectedCalendarEvents(client, calendar, from, to, timeZone) : [],
    staleTime: 60_000, refetchInterval: 60_000, retry: false, gcTime: 0,
  })) });
}
