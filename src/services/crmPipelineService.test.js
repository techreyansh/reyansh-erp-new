import { consolidateFollowups } from "./crmPipelineService";

describe("consolidateFollowups (no repeated companies)", () => {
  test("collapses multiple follow-ups for the same account into one (soonest)", () => {
    const items = [
      { kind: "action", id: "p1", pipelineId: "p1", company: "Calcom", date: "2026-06-25" },
      { kind: "activity", id: "a1", pipelineId: "p1", company: "Calcom", date: "2026-06-22" },
    ];
    const out = consolidateFollowups(items);
    expect(out).toHaveLength(1);
    expect(out[0].company).toBe("Calcom");
    expect(out[0].date).toBe("2026-06-22"); // soonest wins
  });

  test("on a same-date tie, prefers the pipeline 'action' over an activity", () => {
    const items = [
      { kind: "activity", id: "a1", pipelineId: "p1", company: "Daikin", date: "2026-06-23" },
      { kind: "action", id: "p1", pipelineId: "p1", company: "Daikin", date: "2026-06-23" },
    ];
    const out = consolidateFollowups(items);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("action");
  });

  test("keeps distinct accounts separate", () => {
    const items = [
      { kind: "action", id: "p1", pipelineId: "p1", company: "Calcom", date: "2026-06-22" },
      { kind: "activity", id: "a2", pipelineId: "p2", company: "Fiem", date: "2026-06-22" },
    ];
    expect(consolidateFollowups(items).map((x) => x.company).sort()).toEqual(["Calcom", "Fiem"]);
  });

  test("drops items without a date and tolerates empty input", () => {
    expect(consolidateFollowups([{ pipelineId: "p1", company: "X" }])).toHaveLength(0);
    expect(consolidateFollowups([])).toEqual([]);
    expect(consolidateFollowups(null)).toEqual([]);
  });
});
