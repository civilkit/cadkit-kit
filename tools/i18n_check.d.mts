export const ROOT: string;
export function sourceFiles(): string[];
export function scanHardcoded(files: string[]): { at: string; file: string; text: string }[];
export function schemaFeatures(): Record<string, Record<string, string[]>>;
export function editorEnums(): Record<string, string[]>;
export function loadCatalogs(files: string[]): { en: Map<string, { key: string; value: string }>; dups: unknown[]; langs: Record<string, Map<string, unknown>> };
export function run(o?: { fast?: boolean; updateBaseline?: boolean; report?: boolean }): { errors: string[]; warnings: string[]; stats: Record<string, unknown> };
