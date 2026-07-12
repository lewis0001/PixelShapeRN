/**
 * @botforge/behavior-ts — Behavior Script JSON (BSJ) types, zod schema, and
 * reference interpreter. Phase-0 placeholder; real implementation lands in
 * Phase 1.
 */

/** Current Behavior Script JSON (BSJ) format version. */
export const BSJ_VERSION = 1;

/**
 * Placeholder stub for a Behavior Script JSON program.
 *
 * The full BSJ program structure (nodes, edges, triggers, actions) is
 * specified in the project plan, §5.3. This stub will be replaced by the
 * complete zod-derived type in Phase 1.
 */
export type BsjProgram = {
  /** BSJ format version; must equal {@link BSJ_VERSION}. */
  version: typeof BSJ_VERSION;
};
