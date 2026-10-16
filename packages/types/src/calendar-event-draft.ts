import { z } from "zod";
import { CalendarValueSchema } from "./calendar.js";
import { connectorCalendarDraftTargetSchema, connectorDraftDeliverySchema } from "./connectors.js";

export const CalendarEventDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(1000),
  description: z.string().max(20000).default(""),
  location: z.string().max(2000).default(""),
  start: CalendarValueSchema.describe("ISO date for all-day events, or ISO date-time. Local date-times use timeZone; provide an offset for ambiguous DST times."),
  end: CalendarValueSchema.describe("Exclusive end. For a one-day all-day event use the following date."),
  timeZone: z.string().max(100).default("Europe/Berlin").refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid time zone."),
  organizer: z.union([z.email(), z.literal("")]).default(""),
  attendees: z.string().max(2000).default("").refine(value => value.split(",").every(email => !email.trim() || z.email().safeParse(email.trim()).success), "Use comma-separated email addresses."),
  url: z.union([z.url({ protocol: /^https?$/ }), z.literal("")]).default(""),
  reminders: z.array(z.number().int().min(0).max(525600)).max(20).default([15]),
  googleMeet: z.boolean().default(false),
});
export type CalendarEventDraftInput = z.infer<typeof CalendarEventDraftInputSchema>;
export const GoogleCalendarDraftMetadataSchema = z.object({
  requestId: z.uuid(),
  canAddMeet: z.boolean().optional(),
  conference: z.object({ status: z.enum(["none", "pending", "success", "failure"]), type: z.string().optional(), url: z.url({ protocol: /^https$/ }).optional() }).strict(),
  update: z.object({ eventId: z.string().min(1), etag: z.string().min(1), original: CalendarEventDraftInputSchema, recurringEventId: z.string().optional(), webUrl: z.url({ protocol: /^https$/ }).optional() }).strict().optional(),
}).strict();
export const CalendarEventDraftSchema = CalendarEventDraftInputSchema.extend({
  id: z.uuid(), workspaceId: z.string(), revision: z.uuid(),
  sequence: z.number().int().nonnegative(), path: z.string(), updatedAt: z.number(), startInstant: z.string(), endInstant: z.string(),
  connectorTarget: connectorCalendarDraftTargetSchema.optional(), delivery: connectorDraftDeliverySchema.optional(),
  googleCalendar: GoogleCalendarDraftMetadataSchema.optional(),
});
export type CalendarEventDraft = z.infer<typeof CalendarEventDraftSchema>;
