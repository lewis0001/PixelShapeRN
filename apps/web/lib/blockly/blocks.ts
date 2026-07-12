/**
 * BSJ v1 custom block set (PLAN.md §5.3) — one block per op / expr / event,
 * plus the workspace-only `bsj_var_decl` block that carries a program's
 * `vars` declarations (name + init) on the canvas.
 *
 * Everything in this module except `registerBsjBlocks` is PLAIN DATA
 * (Blockly's JSON block-definition + toolbox formats), so tests can verify
 * the inventory in Node without loading Blockly. Field/input names must stay
 * in sync with lib/blockly/codec.ts.
 */

import type * as BlocklyNs from "blockly/core";

/** One colour per toolbox category (§ Phase 3.2). Move owns forge orange. */
export const CATEGORY_COLOURS = {
  Events: "#eab308",
  Move: "#ff6b35",
  Sense: "#3b82f6",
  "Light & Sound": "#a855f7",
  Logic: "#22c55e",
  Loops: "#14b8a6",
  Variables: "#ef4444",
} as const;

export type CategoryName = keyof typeof CATEGORY_COLOURS;

const C = CATEGORY_COLOURS;

/** Blockly JSON block definitions for the complete BSJ v1 surface. */
export const BSJ_BLOCK_DEFINITIONS = [
  /* ---------------------------- Events ---------------------------- */
  {
    type: "bsj_on_start",
    message0: "when started",
    nextStatement: null,
    colour: C.Events,
    hat: "cap",
    tooltip: "Runs once when the behavior starts.",
  },
  {
    type: "bsj_on_tick",
    message0: "every %1 ms",
    args0: [{ type: "field_number", name: "MS", value: 100, min: 1, precision: 1 }],
    nextStatement: null,
    colour: C.Events,
    hat: "cap",
    tooltip: "Runs repeatedly on a timer. If the previous run is still going, a firing is skipped.",
  },
  {
    type: "bsj_on_button",
    message0: "when button pressed",
    nextStatement: null,
    colour: C.Events,
    hat: "cap",
    tooltip: "Runs when the robot's BOOT button is pressed.",
  },

  /* ----------------------------- Move ----------------------------- */
  {
    type: "bsj_drive",
    message0: "drive left %1 right %2",
    args0: [
      { type: "input_value", name: "L" },
      { type: "input_value", name: "R" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Move,
    tooltip: "Set wheel power (-100 to 100) and keep going.",
  },
  {
    type: "bsj_drive_time",
    message0: "drive left %1 right %2 for %3 ms",
    args0: [
      { type: "input_value", name: "L" },
      { type: "input_value", name: "R" },
      { type: "input_value", name: "MS" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Move,
    tooltip: "Drive for a time, then stop. Other blocks keep running meanwhile.",
  },
  {
    type: "bsj_stop",
    message0: "stop driving",
    previousStatement: null,
    nextStatement: null,
    colour: C.Move,
    tooltip: "Stop both wheels.",
  },
  {
    type: "bsj_servo",
    message0: "servo %1 to %2 °",
    args0: [
      { type: "field_input", name: "ID", text: "head" },
      { type: "input_value", name: "DEG" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Move,
    tooltip: "Move a servo to an angle (0-180°).",
  },
  {
    type: "bsj_servo_sweep",
    message0: "sweep servo %1 from %2 ° to %3 ° in %4 ms",
    args0: [
      { type: "field_input", name: "ID", text: "head" },
      { type: "input_value", name: "FROM" },
      { type: "input_value", name: "TO" },
      { type: "input_value", name: "MS" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Move,
    tooltip: "Glide a servo between two angles. Other blocks keep running meanwhile.",
  },

  /* ----------------------------- Sense ---------------------------- */
  {
    type: "bsj_sensor",
    message0: "%1",
    args0: [
      {
        type: "field_dropdown",
        name: "SENSOR",
        options: [
          ["range (mm)", "range.mm"],
          ["line left", "line.l"],
          ["line right", "line.r"],
        ],
      },
    ],
    output: null,
    colour: C.Sense,
    tooltip: "Read a sensor: range in mm, or line sensors (0-4095).",
  },
  {
    type: "bsj_call",
    message0: "%1",
    args0: [
      {
        type: "field_dropdown",
        name: "FN",
        options: [
          ["battery %", "battery_pct"],
          ["elapsed ms", "elapsed_ms"],
        ],
      },
    ],
    output: null,
    colour: C.Sense,
    tooltip: "Battery charge (0-100) or milliseconds since the behavior started.",
  },

  /* ------------------------- Light & Sound ------------------------ */
  {
    type: "bsj_led",
    message0: "led red %1 green %2 blue %3 pixel %4",
    args0: [
      { type: "input_value", name: "R" },
      { type: "input_value", name: "G" },
      { type: "input_value", name: "B" },
      { type: "input_value", name: "ID" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C["Light & Sound"],
    tooltip: "Set LED colour (0-255 each). Leave pixel empty to set all pixels.",
  },
  {
    type: "bsj_led_off",
    message0: "leds off pixel %1",
    args0: [{ type: "input_value", name: "ID" }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C["Light & Sound"],
    tooltip: "Turn LEDs off. Leave pixel empty to turn off all pixels.",
  },
  {
    type: "bsj_tone",
    message0: "play tone %1 Hz for %2 ms",
    args0: [
      { type: "input_value", name: "HZ" },
      { type: "input_value", name: "MS" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C["Light & Sound"],
    tooltip: "Beep the buzzer.",
  },
  {
    type: "bsj_log",
    message0: "log %1",
    args0: [{ type: "field_input", name: "MSG", text: "hello" }],
    previousStatement: null,
    nextStatement: null,
    colour: C["Light & Sound"],
    tooltip: "Write a message to the robot log / simulator console.",
  },

  /* ----------------------------- Logic ---------------------------- */
  {
    type: "bsj_if",
    message0: "if %1",
    args0: [{ type: "input_value", name: "COND" }],
    message1: "%1",
    args1: [{ type: "input_statement", name: "BODY" }],
    previousStatement: null,
    nextStatement: null,
    colour: C.Logic,
    tooltip: "Run the blocks inside when the condition is true.",
  },
  {
    type: "bsj_if_else",
    message0: "if %1",
    args0: [{ type: "input_value", name: "COND" }],
    message1: "%1",
    args1: [{ type: "input_statement", name: "BODY" }],
    message2: "else",
    message3: "%1",
    args3: [{ type: "input_statement", name: "ELSE" }],
    previousStatement: null,
    nextStatement: null,
    colour: C.Logic,
    tooltip: "Run the first blocks when true, otherwise the else blocks.",
  },
  {
    type: "bsj_cmp",
    message0: "%1 %2 %3",
    args0: [
      { type: "input_value", name: "A" },
      {
        type: "field_dropdown",
        name: "OP",
        options: [
          ["<", "<"],
          ["≤", "<="],
          [">", ">"],
          ["≥", ">="],
          ["=", "=="],
          ["≠", "!="],
        ],
      },
      { type: "input_value", name: "B" },
    ],
    inputsInline: true,
    output: null,
    colour: C.Logic,
    tooltip: "Compare two values.",
  },
  {
    type: "bsj_logic",
    message0: "%1 %2 %3",
    args0: [
      { type: "input_value", name: "A" },
      {
        type: "field_dropdown",
        name: "OP",
        options: [
          ["and", "and"],
          ["or", "or"],
        ],
      },
      { type: "input_value", name: "B" },
    ],
    inputsInline: true,
    output: null,
    colour: C.Logic,
    tooltip: "True when both are true (and) / either is true (or).",
  },
  {
    type: "bsj_not",
    message0: "not %1",
    args0: [{ type: "input_value", name: "A" }],
    inputsInline: true,
    output: null,
    colour: C.Logic,
    tooltip: "True becomes false, false becomes true.",
  },
  {
    type: "bsj_number",
    message0: "%1",
    args0: [{ type: "field_number", name: "NUM", value: 0 }],
    output: null,
    colour: C.Logic,
    tooltip: "A number.",
  },
  {
    type: "bsj_math",
    message0: "%1 %2 %3",
    args0: [
      { type: "input_value", name: "A" },
      {
        type: "field_dropdown",
        name: "OP",
        options: [
          ["+", "+"],
          ["-", "-"],
          ["×", "*"],
          ["÷", "/"],
          ["min", "min"],
          ["max", "max"],
        ],
      },
      { type: "input_value", name: "B" },
    ],
    inputsInline: true,
    output: null,
    colour: C.Logic,
    tooltip: "Arithmetic on two values.",
  },
  {
    type: "bsj_rand",
    message0: "random %1 to %2",
    args0: [
      { type: "input_value", name: "MIN" },
      { type: "input_value", name: "MAX" },
    ],
    inputsInline: true,
    output: null,
    colour: C.Logic,
    tooltip: "A random whole number between min and max.",
  },

  /* ----------------------------- Loops ---------------------------- */
  {
    type: "bsj_repeat",
    message0: "repeat %1 times",
    args0: [{ type: "input_value", name: "N" }],
    message1: "%1",
    args1: [{ type: "input_statement", name: "BODY" }],
    previousStatement: null,
    nextStatement: null,
    colour: C.Loops,
    tooltip: "Run the blocks inside a fixed number of times.",
  },
  {
    type: "bsj_while",
    message0: "while %1",
    args0: [{ type: "input_value", name: "COND" }],
    message1: "%1",
    args1: [{ type: "input_statement", name: "BODY" }],
    previousStatement: null,
    nextStatement: null,
    colour: C.Loops,
    tooltip: "Repeat the blocks inside while the condition is true.",
  },
  {
    type: "bsj_forever",
    message0: "forever",
    message1: "%1",
    args1: [{ type: "input_statement", name: "BODY" }],
    previousStatement: null,
    nextStatement: null,
    colour: C.Loops,
    tooltip: "Repeat the blocks inside until the behavior stops.",
  },
  {
    type: "bsj_wait",
    message0: "wait %1 ms",
    args0: [{ type: "input_value", name: "MS" }],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Loops,
    tooltip: "Pause this script. Other scripts keep running.",
  },
  {
    type: "bsj_break",
    message0: "break out of loop",
    previousStatement: null,
    nextStatement: null,
    colour: C.Loops,
    tooltip: "Exit the innermost loop.",
  },

  /* --------------------------- Variables -------------------------- */
  {
    type: "bsj_var_decl",
    message0: "variable %1 starts at %2",
    args0: [
      { type: "field_input", name: "NAME", text: "score" },
      { type: "field_number", name: "INIT", value: 0 },
    ],
    colour: C.Variables,
    tooltip: "Declare a variable and its starting value. Park it anywhere on the canvas (max 8).",
  },
  {
    type: "bsj_set_var",
    message0: "set %1 to %2",
    args0: [
      { type: "field_input", name: "NAME", text: "score" },
      { type: "input_value", name: "VALUE" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Variables,
    tooltip: "Set a declared variable to a value.",
  },
  {
    type: "bsj_change_var",
    message0: "change %1 by %2",
    args0: [
      { type: "field_input", name: "NAME", text: "score" },
      { type: "input_value", name: "VALUE" },
    ],
    inputsInline: true,
    previousStatement: null,
    nextStatement: null,
    colour: C.Variables,
    tooltip: "Add a value to a declared variable.",
  },
  {
    type: "bsj_var_get",
    message0: "%1",
    args0: [{ type: "field_input", name: "NAME", text: "score" }],
    output: null,
    colour: C.Variables,
    tooltip: "The current value of a variable.",
  },
] as const;

/** All custom block type names, in definition order. */
export const BSJ_BLOCK_TYPES = BSJ_BLOCK_DEFINITIONS.map((d) => d.type);

/* ------------------------------------------------------------------ */
/* Toolbox                                                             */
/* ------------------------------------------------------------------ */

const numShadow = (n: number) => ({ shadow: { type: "bsj_number", fields: { NUM: n } } });

function block(type: string, inputs?: Record<string, unknown>) {
  return inputs ? { kind: "block", type, inputs } : { kind: "block", type };
}

/**
 * Category toolbox: Events / Move / Sense / Light & Sound / Logic / Loops /
 * Variables, one colour per category. Plain data (Blockly toolbox JSON).
 */
export const BSJ_TOOLBOX = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Events",
      colour: C.Events,
      contents: [block("bsj_on_start"), block("bsj_on_tick"), block("bsj_on_button")],
    },
    {
      kind: "category",
      name: "Move",
      colour: C.Move,
      contents: [
        block("bsj_drive", { L: numShadow(70), R: numShadow(70) }),
        block("bsj_drive_time", { L: numShadow(70), R: numShadow(70), MS: numShadow(500) }),
        block("bsj_stop"),
        block("bsj_servo", { DEG: numShadow(90) }),
        block("bsj_servo_sweep", { FROM: numShadow(45), TO: numShadow(135), MS: numShadow(800) }),
      ],
    },
    {
      kind: "category",
      name: "Sense",
      colour: C.Sense,
      contents: [block("bsj_sensor"), block("bsj_call")],
    },
    {
      kind: "category",
      name: "Light & Sound",
      colour: C["Light & Sound"],
      contents: [
        block("bsj_led", { R: numShadow(255), G: numShadow(107), B: numShadow(53) }),
        block("bsj_led_off"),
        block("bsj_tone", { HZ: numShadow(880), MS: numShadow(200) }),
        block("bsj_log"),
      ],
    },
    {
      kind: "category",
      name: "Logic",
      colour: C.Logic,
      contents: [
        block("bsj_if"),
        block("bsj_if_else"),
        block("bsj_cmp", { A: numShadow(0), B: numShadow(0) }),
        block("bsj_logic"),
        block("bsj_not"),
        block("bsj_number"),
        block("bsj_math", { A: numShadow(0), B: numShadow(0) }),
        block("bsj_rand", { MIN: numShadow(0), MAX: numShadow(10) }),
      ],
    },
    {
      kind: "category",
      name: "Loops",
      colour: C.Loops,
      contents: [
        block("bsj_repeat", { N: numShadow(4) }),
        block("bsj_while"),
        block("bsj_forever"),
        block("bsj_wait", { MS: numShadow(500) }),
        block("bsj_break"),
      ],
    },
    {
      kind: "category",
      name: "Variables",
      colour: C.Variables,
      contents: [
        block("bsj_var_decl"),
        block("bsj_set_var", { VALUE: numShadow(0) }),
        block("bsj_change_var", { VALUE: numShadow(1) }),
        block("bsj_var_get"),
      ],
    },
  ],
} as const;

/* ------------------------------------------------------------------ */
/* Registration (browser only — takes the loaded Blockly namespace)    */
/* ------------------------------------------------------------------ */

let registered = false;

/**
 * Register the BSJ block set with Blockly. Idempotent. The Blockly namespace
 * is passed in (rather than imported here) so this module stays importable
 * in Node tests without loading Blockly.
 */
export function registerBsjBlocks(blockly: typeof BlocklyNs): void {
  if (registered) return;
  registered = true;
  blockly.defineBlocksWithJsonArray(
    BSJ_BLOCK_DEFINITIONS as unknown as Parameters<typeof blockly.defineBlocksWithJsonArray>[0]
  );
}
