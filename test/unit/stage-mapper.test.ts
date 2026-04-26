import { StageMapper, defaultStageMapping } from "../../src/application/stage-mapper";

describe("StageMapper", () => {
  it("maps the default SDD stages to Linear workflow states", () => {
    const mapper = new StageMapper();

    expect(mapper.map("spec")).toBe("Backlog");
    expect(mapper.map("plan")).toBe("Todo");
    expect(mapper.map("tasks")).toBe("Todo");
    expect(mapper.map("implement")).toBe("In Progress");
    expect(mapper.map("review")).toBe("In Review");
    expect(mapper.map("done")).toBe("Done");
    expect(defaultStageMapping.implement).toBe("In Progress");
  });

  it("supports configurable mappings within an allowed stage subset", () => {
    const mapper = new StageMapper({
      allowedStages: ["spec", "plan", "tasks"],
      mapping: {
        plan: "Ready",
      },
    });

    expect(mapper.map("plan")).toBe("Ready");
    expect(() => mapper.map("implement")).toThrowError(
      "Stage \"implement\" is not allowed for Linear sync.",
    );
  });
});
