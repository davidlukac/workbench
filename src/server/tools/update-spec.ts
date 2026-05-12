import { resolve } from "node:path";
import * as z from "zod/v4";
import type { Logger } from "../../logging/logger.js";
import type { SpecRepository } from "../../repository/index.js";
import {
  acceptanceCriterionSchema,
  openQuestionSchema,
  requirementSchema,
  specSchema
} from "../../types.js";
import type { Spec } from "../../types.js";

const SPEC_FIELD_VALIDATORS: Record<string, z.ZodTypeAny> = {
  story_id: z.string().min(1),
  background: z.string().min(1),
  goals: z.array(z.string().min(1)),
  non_goals: z.array(z.string()),
  requirements: z.array(requirementSchema),
  open_questions: z.array(openQuestionSchema),
  acceptance_criteria: z.array(acceptanceCriterionSchema)
};

const REQUIRED_FOR_COMPLETENESS: ReadonlyArray<keyof Spec> = [
  "story_id",
  "background",
  "goals",
  "acceptance_criteria"
];

/** MCP input schema for the `update_spec` tool. */
export const updateSpecInputSchema = {
  base_revision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Current revision for optimistic locking. Omit to skip the check."),
  fields: z
    .object({
      story_id: z.string().min(1),
      background: z.string().min(1),
      goals: z.array(z.string().min(1)),
      non_goals: z.array(z.string()),
      requirements: z.array(requirementSchema),
      open_questions: z.array(openQuestionSchema),
      acceptance_criteria: z.array(acceptanceCriterionSchema)
    })
    .partial()
    .passthrough()
    .describe(
      "Partial spec fields to update. All properties are optional; unknown keys are rejected."
    )
};

/** MCP output schema for the `update_spec` tool. */
export const updateSpecOutputSchema = {
  updated: z.array(z.string()).describe("Field names that were accepted and persisted"),
  rejected: z
    .array(z.object({ field: z.string(), reason: z.string() }))
    .describe("Fields rejected with reason"),
  current: specSchema.describe("Full current spec state after update"),
  completeness: z
    .object({
      complete: z.boolean(),
      missing: z.array(z.string()),
      invalid: z.array(z.string())
    })
    .describe("Spec completeness report"),
  revision: z.number().int().min(0).describe("Current revision number after update"),
  spec_file: z
    .string()
    .nullable()
    .describe(
      "Absolute path where the agent should write the human-readable spec.md file (.workbench/<story-id>/spec.md). Null if story_id is not yet set."
    )
};

/** Structured return type of the `update_spec` tool handler. */
export type UpdateSpecResult = {
  updated: string[];
  rejected: { field: string; reason: string }[];
  current: Spec;
  completeness: { complete: boolean; missing: string[]; invalid: string[] };
  revision: number;
  spec_file: string | null;
};

/**
 * Validates and persists partial Spec field updates with optimistic locking.
 * Returns updated fields, rejected fields with reasons, current state, completeness report, and revision.
 */
export async function updateSpecTool(
  args: { base_revision?: number | undefined; fields: Record<string, unknown> },
  logger: Logger,
  specRepo: SpecRepository,
  workspacePath: string
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: UpdateSpecResult;
  isError?: true;
}> {
  await logger.info("tool_invocation_started", { tool: "update_spec" });

  const existing = await specRepo.readSpec();
  const current: Spec = existing ?? { revision: 0 };

  if (args.base_revision !== undefined && args.base_revision !== current.revision) {
    const msg = `Stale revision: expected ${current.revision}, got ${args.base_revision}`;
    await logger.error("tool_invocation_stale_revision", {
      tool: "update_spec",
      expected: current.revision,
      provided: args.base_revision
    });
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  const updated: string[] = [];
  const rejected: { field: string; reason: string }[] = [];
  const next: Spec = { ...current };

  for (const [field, value] of Object.entries(args.fields)) {
    const validator = SPEC_FIELD_VALIDATORS[field];
    if (validator === undefined) {
      rejected.push({ field, reason: "unknown field" });
      continue;
    }
    const parsed = validator.safeParse(value);
    if (!parsed.success) {
      const reason = parsed.error.issues
        .map((i) => {
          const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
          return `${path}${i.message}`;
        })
        .join("; ");
      rejected.push({ field, reason });
      continue;
    }
    (next as Record<string, unknown>)[field] = parsed.data;
    updated.push(field);
  }

  if (updated.length > 0) {
    const saved = await specRepo.upsertSpec(next);
    next.revision = saved.revision;
  }

  const missing: string[] = [];
  for (const req of REQUIRED_FOR_COMPLETENESS) {
    const val = next[req];
    if (val === undefined || (Array.isArray(val) && val.length === 0)) {
      missing.push(req as string);
    }
  }

  const spec_file =
    next.story_id !== undefined ? resolve(workspacePath, next.story_id, "spec.md") : null;

  const result: UpdateSpecResult = {
    updated,
    rejected,
    current: next,
    completeness: {
      complete: missing.length === 0,
      missing,
      invalid: rejected.map((r) => r.field)
    },
    revision: next.revision,
    spec_file
  };

  await logger.info("tool_invocation_succeeded", {
    tool: "update_spec",
    updated,
    rejected: rejected.length,
    revision: next.revision
  });

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    structuredContent: result
  };
}
