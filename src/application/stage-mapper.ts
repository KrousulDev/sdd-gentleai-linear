import { type SddStage, sddStages } from "../domain/workflow-state";

export type LinearStage =
  | "Backlog"
  | "Todo"
  | "In Progress"
  | "In Review"
  | "Done"
  | (string & {});

export type StageMapping = Record<SddStage, LinearStage>;

export const defaultStageMapping: StageMapping = {
  spec: "Backlog",
  plan: "Todo",
  tasks: "Todo",
  implement: "In Progress",
  review: "In Review",
  done: "Done",
};

export interface StageMapperOptions {
  mapping?: Partial<StageMapping>;
  allowedStages?: SddStage[];
}

export class StageMapper {
  private readonly mapping: StageMapping;
  private readonly allowedStages: Set<SddStage>;

  constructor(options: StageMapperOptions = {}) {
    this.mapping = { ...defaultStageMapping };

    if (options.mapping) {
      for (const stage of sddStages) {
        const mappedStage = options.mapping[stage];

        if (mappedStage) {
          this.mapping[stage] = mappedStage;
        }
      }
    }

    this.allowedStages = new Set(options.allowedStages ?? sddStages);
  }

  map(stage: SddStage): LinearStage {
    this.assertAllowed(stage);
    return this.mapping[stage];
  }

  isAllowed(stage: SddStage): boolean {
    return this.allowedStages.has(stage);
  }

  private assertAllowed(stage: SddStage): void {
    if (!this.allowedStages.has(stage)) {
      throw new Error(`Stage "${stage}" is not allowed for Linear sync.`);
    }
  }
}
