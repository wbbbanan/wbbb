import type { PlanStep, VerificationResponse } from '../shared/ipc';
import type { WorkflowContext } from './workflowHelpers';
import { getWorkflowConfig, renderPromptTemplate } from './configManager';

export const buildPlanningPrompt = (context: WorkflowContext): string => {
  const maxPlanSteps = getWorkflowConfig().maxPlanSteps;
  const schemaBlock = [
    '请严格输出 JSON，不要输出 Markdown 代码块或额外解释。',
    '【硬性限制】plan 数组最多包含 {{maxPlanSteps}} 个步骤，超出将被自动拒绝。',
    '{',
    '  "plan": [ { "step_id": 1, "description": "string" } ],  // 最多 {{maxPlanSteps}} 个元素',
    '  "expanded_prompt_for_current_step": "string",',
    '  "current_step_id": 1,',
    '  "collaboration_hints": {',
    '    "execution_mode": "single-agent" | "coordinator",',
    '    "suggested_agent_roles": ["string"],',
    '    "coordination_notes": "string"',
    '  }',
    '}',
  ].join('\n').replaceAll('{{maxPlanSteps}}', String(maxPlanSteps));

  const planningGuardrails = [
    '你当前处于规划模式，不允许执行需求本身。',
    '严禁调用任何工具，严禁读写文件，严禁运行命令，严禁修改代码。',
    '你的唯一任务是分析用户需求，并输出严格 JSON。',
    '',
    '【拆分要求】你必须将需求拆分为尽可能细粒度的原子步骤。每个步骤必须满足：',
    '1. 只做一件事——一个独立的、可单独验证的改动',
    '2. 有明确的完成标准——具体到文件路径、函数名、预期行为',
    '3. 禁止模糊描述——不允许"优化代码"、"完善逻辑"等，必须写明具体改什么、改到什么程度',
    '4. 步骤之间尽量解耦——每步完成后代码应处于可编译可运行状态',
    '',
    '步骤数量建议：简单需求 5-10 步，中等需求 10-20 步，复杂需求 20+ 步。宁可多拆不要少拆。',
  ].join('\n');

  if (context.plan.length === 0) {
    return renderPromptTemplate(getWorkflowConfig().promptTemplates.planningInitial, {
      planningGuardrails,
      userPrompt: context.userPrompt,
      planningSchemaBlock: schemaBlock,
      maxPlanSteps: String(getWorkflowConfig().maxPlanSteps),
    });
  }

  const currentStep = context.plan[context.currentStepIndex];
  return renderPromptTemplate(getWorkflowConfig().promptTemplates.planningStep, {
    planningGuardrails,
    userPrompt: context.userPrompt,
    planJson: JSON.stringify(context.plan, null, 2),
    currentStepId: String(currentStep.step_id),
    currentStepDescription: currentStep.description,
    planningSchemaBlock: schemaBlock,
  });
};

export const buildVerificationPrompt = (context: WorkflowContext, step: PlanStep): string => {
  const passingScore = getWorkflowConfig().passingScore;
  const schemaBlock = [
    '请严格输出 JSON，不要输出 Markdown 代码块或额外说明。',
    '{',
    '  "status": "approved" | "rejected",',
    '  "score": 1-10,',
    '  "summary": "string",',
    '  "failed_reasons": ["string"],',
    '  "next_instruction": "string",',
    '  "suggested_test_command": "string"',
    '}',
  ].join('\n');

  const scoringRubric = [
    '【评分标准】',
    '10 分：完美。代码完全正确，测试全部通过，风格一致，无任何遗留问题。',
    '9  分：优秀。代码正确，测试通过，仅有极微小的可改进项（如命名、注释）。',
    '8  分：良好。核心逻辑正确，但存在小问题（边界条件处理、错误消息不够清晰）。',
    '7  分：及格。方向正确，但实现有明显缺陷（缺少错误处理、遗漏分支）。',
    '5-6 分：不及格。实现不完整，缺少关键部分，或有明显 bug。',
    '3-4 分：差。方向基本正确，但实现严重不足。',
    '1-2 分：极差。完全错误或未执行任务。',
    '',
    `通过分数线：${passingScore} 分。只有 score >= ${passingScore} 才能 status = "approved"。`,
    '',
    '【验收要求】',
    '1. 必须实际运行验证命令（测试、编译、lint），不能只看代码就判断',
    '2. 对于"代码看起来正确"但没有运行验证的情况，最高给 7 分',
    '3. 如果测试失败，必须 rejected，不能给 8 分以上',
    '4. 必须具体指出问题所在（文件路径、行号），不能笼统说"需要改进"',
  ].join('\n');

  return renderPromptTemplate(getWorkflowConfig().promptTemplates.verification, {
    stepId: String(step.step_id),
    stepDescription: step.description,
    lastExecutionSummary: context.lastExecutionSummary,
    verificationSchemaBlock: schemaBlock,
    scoringRubric,
    passingScore: String(passingScore),
  });
};

export const buildFallbackExecutionPrompt = (context: WorkflowContext, step: PlanStep): string => {
  if (!context) {
    return step.description;
  }

  return renderPromptTemplate(getWorkflowConfig().promptTemplates.fallbackExecution, {
    userPrompt: context.userPrompt,
    stepId: String(step.step_id),
    stepDescription: step.description,
  });
};

export const buildRepairPrompt = (context: WorkflowContext, step: PlanStep, verification: VerificationResponse): string => {
  if (!context) {
    return step.description;
  }

  return renderPromptTemplate(getWorkflowConfig().promptTemplates.repair, {
    userPrompt: context.userPrompt,
    stepId: String(step.step_id),
    stepDescription: step.description,
    lastExecutionSummary: context.lastExecutionSummary,
    failedReasons:
      verification.failed_reasons.length > 0
        ? verification.failed_reasons.map((reason, index) => `${index + 1}. ${reason}`).join('\n')
        : '1. OpenCode 未给出显式失败原因。',
    nextInstruction: verification.next_instruction || '根据失败原因修复并重新验证。',
  });
};