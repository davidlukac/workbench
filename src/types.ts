import * as z from "zod/v4";

export const storySchema = z.object({
  id: z.string().min(1),
  source_type: z.enum(["jira", "mock", "file"]),
  source_ref: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().min(1),
  raw_ac: z.array(z.string()),
  issue_type: z.enum(["story", "bug", "task", "spike"]),
  priority: z.enum(["critical", "high", "medium", "low"]),
  labels: z.array(z.string()),
  reporter: z.string().nullable(),
  assignee: z.string().nullable(),
  fetched_at: z.string().datetime()
});

export type Story = z.infer<typeof storySchema>;

export const requirementSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(["functional", "non_functional", "constraint"]),
  priority: z.enum(["must", "should", "could"])
});

export const openQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  resolved: z.boolean(),
  answer: z.string().nullable()
});

export const acceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  criterion: z.string().min(1),
  testable: z.boolean(),
  source: z.enum(["jira", "generated"])
});

export const specSchema = z.object({
  story_id: z.string().min(1).optional(),
  background: z.string().min(1).optional(),
  goals: z.array(z.string().min(1)).optional(),
  non_goals: z.array(z.string()).optional(),
  requirements: z.array(requirementSchema).optional(),
  open_questions: z.array(openQuestionSchema).optional(),
  acceptance_criteria: z.array(acceptanceCriterionSchema).optional(),
  revision: z.number().int().min(0)
});

export type Requirement = z.infer<typeof requirementSchema>;
export type OpenQuestion = z.infer<typeof openQuestionSchema>;
export type AcceptanceCriterion = z.infer<typeof acceptanceCriterionSchema>;
export type Spec = z.infer<typeof specSchema>;

export const storyStatusSchema = z.enum(["todo", "in_progress", "in_review", "done"]);

export type StoryStatus = z.infer<typeof storyStatusSchema>;

export const STORY_STATUS_TRANSITIONS: Record<StoryStatus, StoryStatus | null> = {
  todo: "in_progress",
  in_progress: "in_review",
  in_review: "done",
  done: null
};

export const taskStatusSchema = z.enum([
  "pending",
  "claimed",
  "in_progress",
  "implemented",
  "review_required",
  "changes_requested",
  "verified",
  "ready_for_signoff",
  "signed_off",
  "blocked",
  "failed"
]);

export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const TASK_STATUS_RANK: Record<TaskStatus, number> = {
  pending: 0,
  claimed: 1,
  in_progress: 2,
  implemented: 3,
  review_required: 4,
  changes_requested: 4,
  verified: 5,
  ready_for_signoff: 6,
  signed_off: 7,
  blocked: -1,
  failed: -1
};

export const taskDependencySchema = z.object({
  taskId: z.string().min(1),
  requiredStatus: z.enum(["verified", "implemented"]).optional()
});

export const taskLockSchema = z.object({
  owner: z.string().min(1),
  expires_at: z.string().datetime()
});

export const taskOutputSchema = z.object({
  summary: z.string().min(1),
  changed_files: z.array(z.string())
});

export const evidenceSchema = z.object({
  commands_run: z.array(z.string()),
  tests_passed: z.array(z.string()),
  changed_files: z.array(z.string()),
  notes: z.array(z.string())
});

export const taskSchema = z.object({
  id: z.string().min(1),
  story_id: z.string().min(1),
  spec_id: z.string().min(1),
  title: z.string().min(1),
  type: z.string().min(1),
  tags: z.array(z.string()),
  persona: z.string().nullable(),
  review_persona: z.string().nullable(),
  status: taskStatusSchema,
  priority: z.number().int().min(1),
  dependencies: z.array(taskDependencySchema),
  planned_files: z.array(z.string()),
  ac_refs: z.array(z.string()),
  fresh_context_required: z.boolean(),
  claimed_by: z.string().nullable(),
  lock: taskLockSchema.nullable(),
  attempt_count: z.number().int().min(0),
  max_attempts: z.number().int().min(1),
  output: taskOutputSchema.nullable(),
  evidence: evidenceSchema,
  error: z.string().nullable(),
  revision: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable()
});

export type TaskDependency = z.infer<typeof taskDependencySchema>;
export type TaskLock = z.infer<typeof taskLockSchema>;
export type TaskOutput = z.infer<typeof taskOutputSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Task = z.infer<typeof taskSchema>;

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
