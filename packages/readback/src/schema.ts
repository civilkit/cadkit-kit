// The slice of JSON schema the tools use (the same shape as @kit/agent-tools' Schema, which validates it).
export interface Schema {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: ReadonlyArray<string | number>;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  additionalProperties?: boolean;
  default?: unknown;
  oneOf?: Schema[];
}
