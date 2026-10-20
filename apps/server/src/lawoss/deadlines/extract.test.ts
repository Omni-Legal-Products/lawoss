import { expect,test } from "bun:test";
import { proposeDeadline } from "./extract.js";
import { fixtureInput } from "./fixtures.js";

test("conflicting source service dates and an unmatched recipient remain blocking manual facts",()=>{
  const input=fixtureInput();input.delivery!.evidence={...input.delivery!.evidence,locator:{...input.delivery!.evidence.locator,quote:"Served on 2026-10-23 or 2026-10-24 to a different recipient"}};
  const proposal=proposeDeadline({workspaceId:"workspace",matterId:"matter",input});expect(proposal.input.uncertainties.some(issue=>issue.code==="conflicting_trigger")).toBe(true);expect(proposal.calculation.kind).toBe("indeterminate");
});

test("Czech and Slovak numeric day units remain usable with accented letters",()=>{
  for(const quote of ["Odvolání do 15 dnů", "Odvolanie do 15 dní"]) {
    const input=fixtureInput();input.evidence=[{...input.evidence[0]!,locator:{...input.evidence[0]!.locator,quote}}];input.statedDuration=15;
    const proposal=proposeDeadline({workspaceId:"workspace",matterId:"matter",input});expect(proposal.input.uncertainties.some(issue=>issue.code==="conflicting_duration")).toBe(false);expect(proposal.input.statedDuration).toBe(15);
  }
});
