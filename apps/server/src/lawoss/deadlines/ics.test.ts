import { expect,test } from "bun:test";
import ICAL from "ical.js";
import { renderDeadlineIcs } from "./ics.js";
import { fixtureInput,fixtureHolidays,fixtureRule } from "./fixtures.js";
import { proposeDeadline } from "./extract.js";
import { calculate } from "./compute.js";

test("unconfirmed candidates cannot produce ICS even when their date calculation is determinate",()=>{
  const candidate=proposeDeadline({workspaceId:"workspace",matterId:"matter",input:fixtureInput()});const calculation=calculate(candidate.input,fixtureRule(),fixtureHolidays()); if(calculation.kind!=="determinate")throw new Error("Synthetic fixture");
  expect(()=>renderDeadlineIcs({...candidate,calculation,export:{uid:"synthetic",sequence:0,decidedAt:"2026-10-17T12:00:00Z",cancelled:false}})).toThrow("confirmation");
});
test("ICS parse-back preserves stable all-day dates/UID/sequence and escapes document-shaped injection",()=>{
  const candidate=proposeDeadline({workspaceId:"workspace",matterId:"Žluťoučký; případ,\r\nBEGIN:VEVENT\r\nATTENDEE:injected",input:fixtureInput()}),calculation=calculate(candidate.input,fixtureRule(),fixtureHolidays());if(calculation.kind!=="determinate")throw new Error("Synthetic fixture");
  const input={...candidate,state:"confirmed" as const,calculation,export:{uid:`lawoss-${candidate.candidateId}@legalwork.local`,sequence:2,decidedAt:"2026-10-17T12:00:00Z",cancelled:false}};
  const result=renderDeadlineIcs(input),again=renderDeadlineIcs(input);expect(again).toEqual(result);
  const root=new ICAL.Component(ICAL.parse(result.bytes)),events=root.getAllSubcomponents("vevent");expect(events).toHaveLength(1);const event=events[0]!;
  expect(String(event.getFirstPropertyValue("dtstart"))).toBe("2026-10-27");expect(String(event.getFirstPropertyValue("dtend"))).toBe("2026-10-28");expect(event.getFirstPropertyValue("uid")).toBe(result.uid);expect(Number(event.getFirstPropertyValue("sequence"))).toBe(2);expect(event.getAllProperties("attendee")).toHaveLength(0);expect(event.getAllProperties("organizer")).toHaveLength(0);expect(event.getAllSubcomponents("valarm")).toHaveLength(0);
});
