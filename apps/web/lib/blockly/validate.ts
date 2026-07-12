/**
 * BSJ program validation → human-readable issue lines, shared by the
 * block editor (export gating) and the /play run/send helpers.
 */

import { bsjProgramSchema, parseBsj, type BsjProgram } from "@botforge/behavior-ts";

/** All §5.3 problems with a program, as human-readable lines ([] = valid). */
export function validationIssues(program: BsjProgram): string[] {
  if (program.handlers.length === 0) {
    return ["Add an event block (Events category) — a program needs at least one handler."];
  }
  try {
    parseBsj(program);
    return [];
  } catch (err) {
    const lines: string[] = [];
    const res = bsjProgramSchema.safeParse(program);
    if (!res.success) {
      for (const issue of res.error.issues.slice(0, 8)) {
        const path = issue.path.length > 0 ? issue.path.join(".") : "program";
        lines.push(`${path} — ${issue.message}`);
      }
      const extra = res.error.issues.length - 8;
      if (extra > 0) lines.push(`…and ${extra} more`);
    }
    if (lines.length === 0) lines.push(err instanceof Error ? err.message : String(err));
    return lines;
  }
}
