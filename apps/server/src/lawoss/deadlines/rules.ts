import cz from "./rule-packs/cz.json" with { type: "json" };
import sk from "./rule-packs/sk.json" with { type: "json" };
import calendars from "./rule-packs/holidays-2026.json" with { type: "json" };
import { z } from "zod";
import { fingerprint } from "./hash.js";
import { daySchema, hashSchema, ruleSchema } from "./schema.js";
import type { HolidaySet, RulePack } from "./types.js";
const calendarSchema=z.strictObject({id:z.string(),jurisdiction:z.enum(["cz","sk"]),years:z.array(z.number().int()).min(1),dates:z.array(daySchema),sources:z.array(z.url()).min(1),hash:hashSchema});
export const holidaySets: readonly HolidaySet[] = calendars.map(value=>{const calendar=calendarSchema.parse(value);const {hash,...content}=calendar;if(fingerprint(content)!==hash)throw new Error("Holiday catalogue checksum mismatch.");return calendar;});
// Source verification is not legal approval. These versioned profiles remain unavailable for confirmation.
export const proposedRulePacks: readonly RulePack[] = [cz,sk].map(value=>{const rule=ruleSchema.parse(value);const {sha256,...content}=rule;if(fingerprint(content)!==sha256)throw new Error("RulePack checksum mismatch.");return rule;});
export function proposedHolidaySet(jurisdiction: "cz" | "sk"): HolidaySet { return holidaySets.find(value=>value.jurisdiction===jurisdiction)!; }
