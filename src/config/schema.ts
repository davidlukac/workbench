import * as z from "zod/v4";

export const dispatchModeSchema = z.enum(["auto", "manual"]);

export const jiraConfigSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("mock")
  }),
  z.object({
    mode: z.literal("cloud"),
    base_url: z.string().url(),
    auth: z.literal("token")
  }),
  z.object({
    mode: z.literal("none").optional()
  })
]);

export const personaSchema = z.object({
  name: z.string().min(1),
  system_prompt: z.string().min(1),
  skills: z.array(z.string().min(1)).default([])
});

export const workbenchConfigSchema = z.object({
  dispatch_mode: dispatchModeSchema,
  jira: jiraConfigSchema.default({ mode: "none" }),
  defaults: z
    .object({
      implementation_persona: z.string().min(1),
      review_persona: z.string().min(1)
    })
    .optional(),
  type_to_persona: z.record(z.string().min(1), z.string().min(1)).default({}),
  personas: z.record(z.string().min(1), personaSchema).default({})
});

export type DispatchMode = z.infer<typeof dispatchModeSchema>;
export type WorkbenchConfig = z.infer<typeof workbenchConfigSchema>;

export type ConfigIssue = {
  path: string;
  message: string;
};

export function validateConfigReferences(config: WorkbenchConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const personaIds = new Set(Object.keys(config.personas));

  if (config.defaults && !personaIds.has(config.defaults.implementation_persona)) {
    issues.push({
      path: "defaults.implementation_persona",
      message: `Unknown persona "${config.defaults.implementation_persona}".`
    });
  }

  if (config.defaults && !personaIds.has(config.defaults.review_persona)) {
    issues.push({
      path: "defaults.review_persona",
      message: `Unknown persona "${config.defaults.review_persona}".`
    });
  }

  for (const [taskType, personaId] of Object.entries(config.type_to_persona)) {
    if (!personaIds.has(personaId)) {
      issues.push({
        path: `type_to_persona.${taskType}`,
        message: `Unknown persona "${personaId}".`
      });
    }
  }

  return issues;
}
