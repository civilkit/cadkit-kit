// @kit/plugin: the plugin system core (headless). Manifest, parameter schema, registry, agent tools, and the built-in plugins.
export { parseManifest, engineOk, safePath, withPlacement, PLACEMENT_PARAMS, type PluginManifest, type GeneratorDecl, type WasmDecl, type FileGrant, type ParsedManifest } from './manifest';
export { checkDefs, checkParams, effectiveValues, checkValue, defaultsOf, previewValues, formModel, isVisible, toJsonSchema, type ParamDef, type ParamType, type SelCategory, type SelItem, SEL_CATEGORIES, SEL_TYPE, type ParamOption, type VisibleIf, type Values, type ParamIssue, type Checked, type FormField, type FormGroup } from './params';
export { trimForPreview, REPEAT_MIN, type TrimmedScript } from './previewTrim';
export { PluginRegistry, contextOf, type GenerateContext, type Plugin, type GenerateFn, type Prepared, type RunRecord } from './registry';
export { caseManifest, generateCase, CASE_PLUGIN_ID } from './builtin/case';
export { springManifest, generateSpring, SPRING_PLUGIN_ID } from './builtin/spring';
import { PluginRegistry } from './registry';
import { caseManifest, generateCase } from './builtin/case';
import { springManifest, generateSpring } from './builtin/spring';

/** A registry holding the built-in plugins. */
export function builtinRegistry(): PluginRegistry {
  const r = new PluginRegistry();
  r.add(caseManifest, { case: generateCase }, { builtin: true });
  r.add(springManifest, { spring: generateSpring }, { builtin: true });
  return r;
}
export { scriptGenerator } from './script';
export { inspectPackage, packageHash, sha256Hex, stripWrapper, parseGithubSpec, isPinnedRef, fetchGithubPackage, fetchZipUrl, MAX_PACKAGE_BYTES, MAX_FILE_BYTES, MAX_FILES, MAX_SCRIPT_CHARS, ALLOWED_EXTENSIONS, WASM_MAX_FILE_BYTES, WASM_MAX_PACKAGE_BYTES, type Inspection, type GithubSpec, type Fetcher } from './package';
export { filesFromZip } from './zip';
export { PluginManager, memoryStore, type InstalledPlugin, type PluginStore, type PluginSource, type Plan, type Change, type ManagerOpts, type ReadResult, type ReadFn } from './manager';
