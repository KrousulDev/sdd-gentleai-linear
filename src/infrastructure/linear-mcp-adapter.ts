import { RetryPolicy, type RetryResult } from "./retry-policy";

export interface LinearMcpClient {
  invoke<T>(operation: string, payload: object): Promise<T>;
}

export interface CreateParentInput {
  sddId: string;
  title: string;
  description: string;
}

export interface LinkParentInput {
  sddId: string;
  linearIssueId: string;
}

export interface SyncStageInput {
  linearIssueId: string;
  linearStage: string;
}

export interface PublishSummaryInput {
  linearIssueId: string;
  summary: string;
}

export interface CreateChildInput {
  parentIssueId: string;
  title: string;
  description: string;
}

export interface LinearIssueRef {
  id: string;
}

export type LinearAdapterResult<T> = RetryResult<T>;

export class LinearMcpAdapter {
  constructor(
    private readonly client: LinearMcpClient,
    private readonly retryPolicy: RetryPolicy = new RetryPolicy(),
  ) {}

  createParent(input: CreateParentInput): Promise<LinearAdapterResult<LinearIssueRef>> {
    return this.invoke("linear.createParent", input);
  }

  linkParent(input: LinkParentInput): Promise<LinearAdapterResult<LinearIssueRef>> {
    return this.invoke("linear.linkParent", input);
  }

  syncStage(input: SyncStageInput): Promise<LinearAdapterResult<void>> {
    return this.invoke("linear.syncStage", input);
  }

  publishSummary(input: PublishSummaryInput): Promise<LinearAdapterResult<void>> {
    return this.invoke("linear.publishSummary", input);
  }

  createChild(input: CreateChildInput): Promise<LinearAdapterResult<LinearIssueRef>> {
    return this.invoke("linear.createChild", input);
  }

  private invoke<T>(
    operation: string,
    payload: object,
  ): Promise<LinearAdapterResult<T>> {
    return this.retryPolicy.execute(() => this.client.invoke<T>(operation, payload));
  }
}
