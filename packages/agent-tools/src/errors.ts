/** A tool failure that carries a stable code and a repair hint for the agent. */
export class ToolError extends Error {
  constructor(public code: string, message: string, public hint?: string, public details?: unknown) { super(message); }
}
