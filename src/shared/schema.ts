import { z } from 'zod';

const claudeExecutionEffortSchema = z.enum(['low', 'medium', 'high', 'max']);
const opencodeVariantSchema = z.enum(['low', 'medium', 'high', 'max']);
const positiveNullableBudgetSchema = z.number().positive().nullable();

export const planStepSchema = z.object({
  step_id: z.number().int().positive(),
  description: z.string().min(1),
  status: z.enum(['pending', 'active', 'completed', 'skipped']).optional(),
  promptOverride: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  skippedAt: z.string().min(1).optional(),
});

export const collaborationHintsSchema = z.object({
  execution_mode: z.enum(['single-agent', 'coordinator']).default('coordinator'),
  suggested_agent_roles: z.array(z.string().min(1)).default([]),
  coordination_notes: z.string().optional(),
});

export const coordinatorDelegateTaskSchema = z.object({
  role: z.string().min(1),
  task_description: z.string().min(1),
  context_summary: z.string().optional(),
});

export const coordinatorDelegateCommandSchema = z
  .object({
    action: z.literal('delegate'),
    role: z.string().min(1).optional(),
    task_description: z.string().min(1).optional(),
    context_summary: z.string().optional(),
    tasks: z.array(coordinatorDelegateTaskSchema).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasSingleTask = typeof value.role === 'string' && typeof value.task_description === 'string';
    const hasTaskList = Array.isArray(value.tasks) && value.tasks.length > 0;

    if (!hasSingleTask && !hasTaskList) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'delegate command requires either role/task_description or tasks.',
      });
    }
  });

export const coordinatorSaveMemoryItemSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
});

export const coordinatorCompleteCommandSchema = z.object({
  action: z.literal('complete'),
  summary: z.string().min(1),
  all_tasks_completed: z.boolean(),
  saveMemories: z.array(coordinatorSaveMemoryItemSchema).optional(),
});

export const coordinatorCommandSchema = z.union([
  coordinatorDelegateCommandSchema,
  coordinatorCompleteCommandSchema,
]);

const collaborationAgentRoleSchema = z.enum(['system', 'opencode-planner', 'claude-coordinator', 'claude-subagent', 'opencode-verifier']);

export const planningCollaborationSuggestedAgentSchema = z.object({
  agent_id: z.string().min(1),
  role: collaborationAgentRoleSchema,
  label: z.string().min(1),
  objective: z.string().min(1),
});

export const planningCollaborationHintsSchema = z.object({
  strategy: z.enum(['single-agent', 'claude-coordinator']).default('single-agent'),
  coordination_goal: z.string().default(''),
  suggested_agents: z.array(planningCollaborationSuggestedAgentSchema).default([]),
});

export const workflowPromptTemplatesSchema = z.object({
  planningInitial: z.string().min(1),
  planningStep: z.string().min(1),
  verification: z.string().min(1),
  fallbackExecution: z.string().min(1),
  repair: z.string().min(1),
  coordinatorExecution: z.string().min(1),
  coordinatorDispatch: z.string().min(1),
  subAgentTask: z.string().min(1),
});

export const workflowRuntimeConfigSchema = z.object({
  claudeEffort: claudeExecutionEffortSchema,
  opencodeVariant: opencodeVariantSchema,
  budgetCapUsd: positiveNullableBudgetSchema,
  commandTimeoutMs: z.number().int().positive(),
  healthTimeoutMs: z.number().int().positive(),
  opencodeTimeoutMs: z.number().int().positive(),
  backoffBaseMs: z.number().int().positive(),
  backoffMaxMs: z.number().int().positive(),
  jsonRepairRetries: z.number().int().min(1).max(10),
  processRetries: z.number().int().min(1).max(10),
  executionRetries: z.number().int().min(1).max(10),
  maxRepairAttemptsPerStep: z.number().int().min(1).max(100),
  maxTotalRepairAttempts: z.number().int().min(1).max(1_000),
  passingScore: z.number().int().min(1).max(10),
  cleanupPeriodDays: z.number().int().min(1).max(3_650),
  collaborationEnabled: z.boolean(),
  maxPlanSteps: z.number().int().min(1).max(50),
  promptTemplates: workflowPromptTemplatesSchema,
});

export const workflowRuntimeConfigUpdateSchema = z.object({
  claudeEffort: claudeExecutionEffortSchema.optional(),
  opencodeVariant: opencodeVariantSchema.optional(),
  budgetCapUsd: positiveNullableBudgetSchema.optional(),
  commandTimeoutMs: z.number().int().positive().optional(),
  healthTimeoutMs: z.number().int().positive().optional(),
  opencodeTimeoutMs: z.number().int().positive().optional(),
  backoffBaseMs: z.number().int().positive().optional(),
  backoffMaxMs: z.number().int().positive().optional(),
  jsonRepairRetries: z.number().int().min(1).max(10).optional(),
  processRetries: z.number().int().min(1).max(10).optional(),
  executionRetries: z.number().int().min(1).max(10).optional(),
  maxRepairAttemptsPerStep: z.number().int().min(1).max(100).optional(),
  maxTotalRepairAttempts: z.number().int().min(1).max(1_000).optional(),
  passingScore: z.number().int().min(1).max(10).optional(),
  cleanupPeriodDays: z.number().int().min(1).max(3_650).optional(),
  collaborationEnabled: z.boolean().optional(),
  maxPlanSteps: z.number().int().min(1).max(50).optional(),
  promptTemplates: workflowPromptTemplatesSchema.partial().optional(),
});

export const planningResponseSchema = z.object({
  plan: z.array(planStepSchema).min(1),
  expanded_prompt_for_current_step: z.string().min(1),
  current_step_id: z.number().int().positive(),
  collaboration_hints: collaborationHintsSchema.optional(),
  collaboration: planningCollaborationHintsSchema.optional(),
});

export const verificationResponseSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  score: z.number().int().min(1).max(10),
  summary: z.string().min(1),
  failed_reasons: z.array(z.string()).default([]),
  next_instruction: z.string().default(''),
  suggested_test_command: z.string().optional(),
});

export const workflowTemplateCreateSchema = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  description: z.string().nullable().optional(),
});

export const workflowTemplateSchema = workflowTemplateCreateSchema.extend({
  id: z.string().min(1),
  createdAt: z.union([z.string().min(1), z.date()]),
  updatedAt: z.union([z.string().min(1), z.date()]),
});

export type WorkflowTemplateCreate = z.infer<typeof workflowTemplateCreateSchema>;
export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;