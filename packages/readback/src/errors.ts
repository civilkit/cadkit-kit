/** A failure with a stable code and a hint (the headless tools turn it into a ToolError, the app link into a BridgeError). */
export class ReadbackError extends Error {
  constructor(readonly code: string, message: string, readonly hint?: string) { super(message); this.name = 'ReadbackError'; }
}
