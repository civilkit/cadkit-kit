// @kit/agent-tools: transport-independent tool definitions over an AgentSession (a kernel Session plus the script runner).
import type { AgentSession } from './agent-session';
import { ToolError } from './errors';
import { capJson } from './output';
import { validate } from './schema';
import { createTools, type ToolDef } from './tools';

export { AgentSession, type AgentSessionOptions, type ScriptRunReport } from './agent-session';
export { createTools, summarize, loadSnapshotFn, type ToolDef, type ToolOutput } from './tools';
export { ToolError } from './errors';
export { defaultRegistry, type Registry, type MethodDoc, type Recipe } from './registry';
export { validate, type Schema } from './schema';
export { capJson, MAX_OUTPUT_CHARS } from './output';
export { meshToGlb } from './exporters';

/** The MCP shape of a tool result. */
export interface CallResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

/** Validate `args`, run the tool, shape the result. Never throws: failures come back as `isError` results with a code and a hint. */
export async function callTool(a: AgentSession, tools: ToolDef[], name: string, args: unknown): Promise<CallResult> {
  const fail = (code: string, message: string, hint?: string, details?: unknown): CallResult => ({
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code, message, ...(hint ? { hint } : {}), ...(details !== undefined ? { details } : {}) } }, null, 1) }],
  });
  const tool = tools.find((t) => t.name === name);
  if (!tool) return fail('unknown_tool', `no tool named ${name}`, `tools: ${tools.map((t) => t.name).join(', ')}`);
  const input = args === undefined || args === null ? {} : args;
  const problems = validate(tool.inputSchema, input);
  if (problems.length) return fail('bad_input', problems.join('; '), `see the input schema of ${name}`, problems);
  try {
    const out = await tool.handler(input as Record<string, unknown>, a);
    const { text, truncated } = capJson(out.data);
    const content: CallResult['content'] = [];
    if (out.summary) content.push({ type: 'text', text: out.summary });
    content.push({ type: 'text', text });
    for (const im of out.images ?? []) content.push({ type: 'image', data: im.data, mimeType: im.mimeType });
    void truncated;
    return { content };
  } catch (e) {
    if (e instanceof ToolError) return fail(e.code, e.message, e.hint, e.details);
    return fail('internal_error', String((e as Error)?.message ?? e), 'the kernel or the tool failed unexpectedly; retry, or restore a checkpoint');
  }
}
