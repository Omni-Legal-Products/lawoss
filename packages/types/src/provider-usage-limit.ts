import { z } from "zod";

/** Safe gateway admission details; money is EUR millionths, never rounded cents. */
export const usageLimitDetailsSchema = z.object({
  reason: z.enum(["member_limit", "organization_limit", "wallet_empty", "extra_disabled", "seat_required", "service_limit"]),
  requiredMicros: z.number().int().positive().max(1_000_000_000),
  availableMicros: z.number().int().nonnegative().max(1_000_000_000),
}).refine(value => value.requiredMicros > value.availableMicros);
export type UsageLimitDetails = z.infer<typeof usageLimitDetailsSchema>;

const MARKER = "LegalWork provider usage limit: ";
export function providerUsageLimitErrorText(providerId: string, limit?: UsageLimitDetails | null) {
  return MARKER + encodeURIComponent(providerId) + (limit ? " " + encodeURIComponent(JSON.stringify(limit)) : "");
}

/** Old provider-only markers remain readable. Malformed details never become actions. */
export function parseProviderUsageLimit(error: string | null | undefined) {
  if (!error?.startsWith(MARKER)) return null;
  const [provider, encoded] = error.slice(MARKER.length).split(" ");
  try {
    const providerId = decodeURIComponent(provider);
    try {
      const parsed = encoded ? usageLimitDetailsSchema.safeParse(JSON.parse(decodeURIComponent(encoded))) : null;
      return { providerId, limit: providerId === "eigenwelt" && parsed?.success ? parsed.data : null };
    } catch { return {providerId,limit:null}; }
  } catch { return null; }
}
