/** Host boundary. Session identity comes from the host, never from model-supplied roles. */
export class HostExecutionError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); this.name = "HostExecutionError"; }
}
export class HostCreationError extends Error {
  constructor(message: string, readonly created: "no" | "unknown", readonly retryable: boolean) {
    super(message); this.name = "HostCreationError";
  }
}

export interface HostAdapter {
  createSession(input: {
    parentSessionId: string; agent: string; directory: string; title: string;
    readOnly?: boolean;
    metadata: Record<string, unknown>;
  }): Promise<string>;
  prompt(input: {
    sessionId: string; agent: string; directory: string; prompt: string;
    schema: Record<string, unknown>; signal?: AbortSignal;
  }): Promise<unknown>;
  abort(sessionId: string, directory: string): Promise<void>;
  status(sessionId: string, directory: string): Promise<"running" | "idle" | "missing" | "unknown">;
  lastResult(sessionId: string, directory: string): Promise<unknown | undefined>;
  activity(input: { parentSessionId: string; planId?: string; taskId?: string; sessionId?: string; agent?: string; role?: string; title?: string; state: string; message: string }): Promise<void>;
}
