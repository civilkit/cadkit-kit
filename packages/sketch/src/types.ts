/**
 * Draft types. A sketch being edited: a detached, mutable copy of a sketch feature that
 * preserves every field the typed model does not know about (round-trips back
 * to an identical feature), plus temporary drag constraints that are dropped
 * on commit and only travel with speculative previews.
 */
export interface DraftPoint {
  id: string;
  x: number;
  y: number;
  fixed?: boolean;
  [key: string]: unknown;
}

export interface DraftEntity {
  id: string;
  [key: string]: unknown;
}

export interface DraftConstraint {
  id: string;
  type: string;
  refs?: string[];
  value?: number | number[];
  [key: string]: unknown;
}

export interface SketchDraft {
  id: string;
  name?: string;
  plane: unknown;
  points: DraftPoint[];
  entities: DraftEntity[];
  constraints: DraftConstraint[];
  /** Temporary constraints (drag fixes): previewed, never committed. */
  temp: DraftConstraint[];
  /** Top-level feature fields outside the known set (seq, visible, ...). */
  extras?: Record<string, unknown>;
}
