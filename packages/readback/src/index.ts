// @kit/readback: read-only measurement tools over the kernel's queries (measure, clearance, interference, thickness, draft, dfm), shared by the
// headless MCP server and the app link, and the injection-moulding undercut rule of the Check tab. No Node or DOM imports.
export { READBACK_TOOLS, APP_READBACK_TOOLS, DFM_PROCESSES, type ReadbackHost, type ReadbackTool, type ToolResult, type Interference, type KernelQueries } from './tools';
export { ReadbackError } from './errors';
export { resolveEntity, faceOwners, bodyList, type BodyRef } from './entities';
export type { Schema } from './schema';
export {
  MOULD_RULE, MOULD_PROFILE, MOULD_LABELS, mouldRuleInfo, withMouldRule, expandMould, mergeMould, checkWithMould, pullLabel,
  type MouldLabels, type MouldSpec, type InlineProfile, type InlineRule, type ProfileList, type ProfileInfo, type RuleInfo, type ProfileReport,
} from './mould';
