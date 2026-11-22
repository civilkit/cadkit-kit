/**
 * A sketch being edited: a detached, mutable copy of a sketch feature that
 * preserves every field the typed model does not know about (round-trips back
 * to an identical feature), plus temporary drag constraints that are dropped
 * on commit and only travel with speculative previews.
 */
export * from './types';
export * from './draft';

// The sketch tools and the snapping they use.
export * from './tools/index';
export * from './snap';
export * from './modelSnaps';
export * from './registry';
export * from './snap-constraints';
export * from './select';
export * from './annotations';
export * from './extrude';
export * from './shapes';
export * from './define';
export * from './replace';
export * from './freedom';
export * from './equation';
export * from './refdims';
export * from './slotLength';
export * from './arcSlotEdit';
export * from './text';
export * from './dimLayout';
export * from './dimPlacement';
export * from './typedPoint';
