import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { WorkflowActivityItem, WorkflowEvent, WorkflowSnapshot } from '../../shared/ipc';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUIStore } from '../../store/uiStore';
import { usePreferenceStore } from '../../store/preferenceStore';
import { useAgentFlow } from '../../hooks/useAgentFlow';
import { useSessions } from '../../hooks/useSessions';
import {
  Send, PanelRight, PanelRightClose, ChevronDown, ChevronUp, Copy, Check,
  Play, Pause, RotateCcw, AlertTriangle, XCircle, CheckCircle, Loader2,
  Wrench, FileText, Search, SlidersHorizontal, Brain, GitBranch, Shield,
} from 'lucide-react';
import { flattenActivityTrace, getActivityTrace, getDetailEntries, snippet, toErrorMessage } from '../../lib/format';
import { lifecycleLabel, sessionLifecycleTone, phaseActorLabels, phaseBorderColors, sourceBorderColors, controlInputClass } from '../../lib/constants';
import { MarkdownRenderer } from '../../components/MarkdownRenderer';
import { ResizablePanel } from '../../components/ResizablePanel';
import { WorkflowSourceMark, type WorkflowSourceMarkKind } from '../../components/WorkflowSourceMark';
import toast from 'react-hot-toast';

// ── Operator Tab ─────────────────────────────────────────────────

const OperatorTab = ({ snapshot, agentFlow, readOnly }: { snapshot: WorkflowSnapshot; agentFlow: ReturnType<typeof useAgentFlow>; readOnly: boolean }) => {
  const [draftDescriptions, setDraftDescriptions] = useState<Record<number, string>>({});
  const [draftOverrides, setDraftOverrides] = useState<Record<number, string>>({});
  const [collaborationInput, setCollaborationInput] = useState('');

  useEffect(() => {
    setDraftDescriptions(Object.fromEntries(snapshot.plan.map((step) => [step.step_id, step.description])));
    setDraftOverrides(Object.fromEntries(snapshot.plan.map((step) => [step.step_id, step.promptOverride ?? ''])));
  }, [snapshot.plan]);

  const handleSave = async (stepId: number) => {
    if (!agentFlow) return;
    try {
      const nextSnapshot = await agentFlow.editPlanStep(stepId, { description: draftDescriptions[stepId], promptOverride: draftOverrides[stepId] });
      useWorkflowStore.getState().setSnapshot(nextSnapshot);
      toast.success(`步骤 ${stepId} 已更新`);
    } catch (error) { toast.error(toErrorMessage(error)); }
  };

  const handleSkip = async (stepId: number) => {
    if (!agentFlow) return;
    try {
      const nextSnapshot = await agentFlow.skipStep(stepId);
      useWorkflowStore.getState().setSnapshot(nextSnapshot);
      toast.success(`步骤 ${stepId} 已跳过`);
    } catch (error) { toast.error(toErrorMessage(error)); }
  };

  const handleSendCollaboration = async () => {
    if (!agentFlow || !collaborationInput.trim()) return;
    try {
      const nextSnapshot = await agentFlow.sendCollaborationMessage(collaborationInput);
      useWorkflowStore.getState().setSnapshot(nextSnapshot);
      setCollaborationInput('');
      toast.success('协作消息已发送');
    } catch (error) { toast.error(toErrorMessage(error)); }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">执行设置</div>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Claude 强度', value: snapshot.executionSettings.claudeEffort },
            { label: 'OpenCode 变体', value: snapshot.executionSettings.opencodeVariant },
            { label: '预算上限', value: snapshot.budget.capUsd == null ? '无限制' : `$${snapshot.budget.capUsd.toFixed(2)}` },
            { label: '已花费', value: `$${snapshot.budget.spentUsd.toFixed(4)}` },
          ].map((item) => (
            <div key={item.label} className="rounded-md bg-[var(--surface-overlay)] px-3 py-2">
              <div className="text-2xs text-[var(--text-muted)]">{item.label}</div>
              <div className="mt-0.5 text-sm font-mono text-[var(--text-primary)]">{item.value}</div>
            </div>
          ))}
        </div>
        {snapshot.budget.exceeded ? (
          <div className="mt-2 rounded-md border border-[var(--warning)]/20 bg-[var(--warning-subtle)] px-3 py-2 text-xs text-[var(--warning)]">
            预算已达上限，请在设置中调整。
          </div>
        ) : null}
      </div>

      <div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">执行计划</div>
        {snapshot.plan.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-4 py-6 text-center text-sm text-[var(--text-muted)]">等待计划加载...</div>
        ) : (
          <div className="space-y-1">
            {snapshot.plan.map((step) => {
              const disabled = readOnly || snapshot.lifecycle === 'running' || step.status === 'completed' || step.status === 'skipped';
              const isCurrent = step.step_id === snapshot.currentStepId;
              return (
                <div key={step.step_id} className={`rounded-md px-3 py-2.5 transition ${isCurrent ? 'bg-[var(--surface-overlay)]' : 'bg-transparent hover:bg-[var(--surface-overlay)]'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-2xs text-[var(--text-muted)]">步骤 {step.step_id}</div>
                    <span className="text-2xs text-[var(--text-muted)]">{step.status ?? '等待中'}</span>
                  </div>
                  <textarea
                    value={draftDescriptions[step.step_id] ?? step.description}
                    onChange={(e) => setDraftDescriptions((current) => ({ ...current, [step.step_id]: e.target.value }))}
                    className="mt-1.5 min-h-[50px] w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] px-2.5 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)]"
                    disabled={readOnly}
                  />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => void handleSave(step.step_id)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition" disabled={disabled || !agentFlow}>保存</button>
                    <button onClick={() => void handleSkip(step.step_id)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition" disabled={disabled || !agentFlow}>跳过</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 text-xs text-[var(--text-muted)]">协作</div>
        <div className="max-h-[200px] space-y-1 overflow-y-auto">
          {(snapshot.collaboration?.messages ?? []).slice(-6).map((message) => (
            <div key={message.messageId} className="rounded-md bg-[var(--surface-overlay)] px-3 py-2 text-xs">
              <div className="text-2xs text-[var(--text-muted)]">{message.source.label}</div>
              <div className="mt-1 whitespace-pre-wrap leading-5 text-[var(--text-secondary)]">{message.content}</div>
            </div>
          ))}
        </div>
        <textarea
          value={collaborationInput}
          onChange={(e) => setCollaborationInput(e.target.value)}
          placeholder="发送协作消息..."
          className="mt-2 min-h-[50px] w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)]"
          disabled={readOnly || !agentFlow}
        />
        <button
          onClick={() => void handleSendCollaboration()}
          className="mt-2 rounded-md bg-[var(--surface-overlay)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] disabled:opacity-40"
          disabled={readOnly || !agentFlow || !collaborationInput.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
};

// ── Chat Sidebar ─────────────────────────────────────────────────

const ChatSidebar = ({
  sessions, activeRunId, onInspect, onNewChat,
}: {
  sessions: Array<{ sessionId: string; runId: string | null; title: string; lifecycle: string; promptPreview: string }>;
  activeRunId: string | null;
  onInspect: (sessionId: string) => void;
  onNewChat: () => void;
}) => {
  const historyQuery = useUIStore((s) => s.historyQuery);
  const setHistoryQuery = useUIStore((s) => s.setHistoryQuery);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--surface-sidebar)]">
      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            id="session-search-input"
            value={historyQuery}
            onChange={(e) => setHistoryQuery(e.target.value)}
            placeholder="搜索会话..."
            className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] py-1.5 pl-7 pr-2 text-xs text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <button
          onClick={onNewChat}
          className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--text-muted)] transition hover:bg-[var(--surface-overlay)] hover:text-[var(--text-secondary)]"
        >
          <div className="flex h-4 w-4 items-center justify-center rounded border border-[var(--border-subtle)]">
            <div className="h-2 w-0.5 bg-[var(--text-muted)]" />
            <div className="absolute h-0.5 w-2 bg-[var(--text-muted)]" />
          </div>
          新建对话
        </button>
        <div className="space-y-0">
          {sessions.map((session) => (
            <button
              key={session.sessionId}
              onClick={() => onInspect(session.sessionId)}
              className={`w-full rounded-md px-2 py-1.5 text-left transition ${activeRunId === session.runId ? 'bg-[var(--surface-overlay)]' : 'hover:bg-[var(--surface-overlay)]'}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm text-[var(--text-primary)]">{session.title}</span>
                <span className={`shrink-0 text-2xs ${sessionLifecycleTone(session.lifecycle as WorkflowSnapshot['lifecycle'])}`}>
                  {lifecycleLabel(session.lifecycle as WorkflowSnapshot['lifecycle'])}
                </span>
              </div>
              <div className="mt-0.5 truncate text-2xs text-[var(--text-muted)]">{session.promptPreview || '无预览'}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// ── Agent Turn — only last message is result, everything else folded ─────────────────

const sourceDisplayLabels: Record<WorkflowSourceMarkKind, string> = {
  system: 'system',
  opencode: 'OpenCode',
  claude: 'Claude',
};

const sourceMarkClasses: Record<WorkflowSourceMarkKind, string> = {
  system: 'text-[var(--text-muted)]',
  opencode: 'text-[var(--text-secondary)]',
  claude: 'text-[#f28a63]',
};

const OpenCodeIcon = ({ className = '' }: { className?: string }) => (
  <WorkflowSourceMark source="opencode" size="xs" className={className} />
);

const ClaudeIcon = ({ className = '' }: { className?: string }) => (
  <WorkflowSourceMark source="claude" size="xs" className={className} />
);

const PhaseIcon = ({ phase, source }: { phase?: string; source?: string }) => {
  // Determine agent type from phase or source fallback
  const isOpenCode = phase === 'planning' || phase === 'verification' || source === 'opencode';
  const isClaude = phase === 'execution' || source === 'claude';

  if (isOpenCode) return <OpenCodeIcon className={sourceMarkClasses.opencode} />;
  if (isClaude) return <ClaudeIcon className={sourceMarkClasses.claude} />;
  if (phase === 'circuit-breaker') return <AlertTriangle size={12} className={sourceMarkClasses.system} />;
  return <GitBranch size={12} className={sourceMarkClasses.system} />;
};

const ProcessItemIcon = ({ kind, source }: { kind: string; source?: string }) => {
  const sourceKind: WorkflowSourceMarkKind = source === 'claude' ? 'claude' : source === 'opencode' ? 'opencode' : 'system';
  switch (kind) {
    case 'thinking':
      return sourceKind === 'claude'
        ? <ClaudeIcon className={sourceMarkClasses.claude} />
        : <OpenCodeIcon className={sourceMarkClasses.opencode} />;
    case 'tool_use':
    case 'tool_result': return <Wrench size={11} className={sourceMarkClasses.system} />;
    case 'message': return <FileText size={11} className={sourceMarkClasses.system} />;
    default: return <GitBranch size={11} className={sourceMarkClasses.system} />;
  }
};

const AgentTurn = ({ items, phase }: { items: WorkflowActivityItem[]; phase?: string }) => {
  const [processExpanded, setProcessExpanded] = useState(false);
  if (items.length === 0) return null;

  const firstItem = items[0];
  const agentName = phaseActorLabels[phase as keyof typeof phaseActorLabels]
    || sourceDisplayLabels[firstItem.source as WorkflowSourceMarkKind]
    || firstItem.source;

  // Determine border color: phase first, then source fallback
  const borderColor = phase
    ? (phaseBorderColors[phase as keyof typeof phaseBorderColors] || 'border-l-[#555555]')
    : (sourceBorderColors[firstItem.source] || 'border-l-[#555555]');

  // Only the last message is the "result"; everything else (including earlier messages) is "process"
  let lastMessageIndex = -1;
  items.forEach((item, i) => { if (item.kind === 'message') lastMessageIndex = i; });

  const resultItem = lastMessageIndex >= 0 ? items[lastMessageIndex] : null;
  const processItems = items.filter((_, i) => i !== lastMessageIndex);

  return (
    <div className={`animate-fade-in-up border-l-2 ${borderColor} pl-3`}>
      {/* Agent header */}
      <div className="mb-1.5 flex items-center gap-2">
        <PhaseIcon phase={phase} source={firstItem.source} />
        <span className="text-2xs font-medium text-[var(--text-secondary)]">{agentName}</span>
        {phase ? <span className="text-2xs text-[var(--text-muted)]">· {phase}</span> : null}
      </div>

      {/* Result — only the last message, always visible */}
      {resultItem ? (
        <div className="space-y-1">
          <MarkdownRenderer content={resultItem.text || resultItem.label} className="text-sm leading-relaxed" />
        </div>
      ) : null}

      {/* Process steps — collapsible (includes earlier messages + thinking + tools) */}
      {processItems.length > 0 ? (
        <div className="mt-2">
          <div
            onClick={() => setProcessExpanded(!processExpanded)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] leading-4 text-[var(--text-muted)] transition hover:text-[var(--text-secondary)] select-none"
          >
            {processExpanded ? '收起过程' : `${processItems.length} 个中间步骤`}
            <span className="text-[10px]">{processExpanded ? '↑' : '>'}</span>
          </div>
          {processExpanded ? (
            <div className="mt-2 space-y-1">
              {processItems.map((item) => {
                if (item.kind === 'message') {
                  return (
                    <div key={item.id} className="flex items-start gap-2">
                      <ProcessItemIcon kind="message" source={item.source} />
                      <div className="flex-1">
                        <span className="text-2xs text-[var(--text-muted)]">消息</span>
                        <MarkdownRenderer content={item.text || item.label} className="text-sm text-[var(--text-secondary)]" />
                      </div>
                    </div>
                  );
                }
                if (item.kind === 'tool_use' || item.kind === 'tool_result') {
                  return <ToolBlock key={item.id} item={item} />;
                }
                if (item.kind === 'thinking') {
                  return (
                    <details key={item.id} className="group">
                      <summary className="flex cursor-pointer items-center gap-1.5 text-2xs text-[var(--text-muted)] transition hover:text-[var(--text-secondary)] list-none">
                        <Brain size={11} className="text-[var(--text-muted)]" />
                        <ChevronDown size={11} className="transition group-open:rotate-180" />
                        思考中
                      </summary>
                      <div className="mt-1">
                        <MarkdownRenderer content={item.text || ''} className="text-sm text-[var(--text-secondary)]" />
                      </div>
                    </details>
                  );
                }
                return (
                  <div key={item.id} className="flex items-start gap-2">
                    <ProcessItemIcon kind={item.kind} source={item.source} />
                    <div className="flex-1">
                      <span className="text-2xs text-[var(--text-muted)]">{item.kind}</span>
                      <div className="text-sm text-[var(--text-secondary)]">{item.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

// ── Tool Block ───────────────────────────────────────────────────

const ToolBlock = ({ item }: { item: WorkflowActivityItem }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-1 overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-center gap-2 py-1 text-left transition hover:opacity-70">
        <Wrench size={11} className="text-[var(--text-muted)]" />
        <span className="text-xs text-[var(--text-muted)]">{item.toolName || item.kind}</span>
        {typeof item.durationMs === 'number' ? <span className="text-2xs font-mono text-[var(--text-muted)]">{item.durationMs}ms</span> : null}
        {item.toolStatus ? (
          <span className={`text-2xs rounded px-1 py-0.5 ${
            item.toolStatus === 'error' ? 'bg-[#ef4444]/10 text-[#ef4444]' :
            item.toolStatus === 'completed' ? 'bg-[#22c55e]/10 text-[#22c55e]' :
            'bg-[var(--surface-overlay)] text-[var(--text-muted)]'
          }`}>{item.toolStatus}</span>
        ) : null}
        <span className="ml-auto text-[var(--text-muted)]">{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</span>
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1">
          {item.input ? <pre className="whitespace-pre-wrap break-words rounded bg-[var(--surface-overlay)] px-2 py-1.5 font-mono text-2xs leading-4 text-[var(--text-muted)]">{item.input}</pre> : null}
          {item.output ? <pre className="whitespace-pre-wrap break-words rounded bg-[var(--surface-overlay)] px-2 py-1.5 font-mono text-2xs leading-4 text-[var(--text-muted)]">{item.output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
};

// ── Timeline Tab ─────────────────────────────────────────────────

const TimelineTab = ({ events }: { events: WorkflowEvent[] }) => {
  const [eventFilter, setEventFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) counts.set(event.status, (counts.get(event.status) ?? 0) + 1);
    return counts;
  }, [events]);

  const filtered = useMemo(
    () => events.filter((event) => {
      if (statusFilter !== 'all' && event.status !== statusFilter) return false;
      if (eventFilter) {
        const q = eventFilter.toLowerCase();
        return [event.title, event.message, event.phase, event.nodeId].join(' ').toLowerCase().includes(q);
      }
      return true;
    }),
    [events, statusFilter, eventFilter]
  );

  return (
    <div className="space-y-3">
      <input
        value={eventFilter}
        onChange={(e) => setEventFilter(e.target.value)}
        placeholder="搜索事件..."
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-muted)]"
      />
      <div className="flex flex-wrap gap-1">
        {['all', 'running', 'success', 'error', 'warning', 'paused'].map((s) => {
          const count = s === 'all' ? events.length : (statusCounts.get(s) ?? 0);
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-md px-2 py-1 text-2xs transition ${statusFilter === s ? 'bg-[var(--surface-overlay)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              {s === 'all' ? '全部' : s === 'running' ? '运行中' : s === 'success' ? '成功' : s === 'error' ? '失败' : s === 'warning' ? '警告' : '暂停'} {count > 0 ? count : ''}
            </button>
          );
        })}
      </div>
      <div className="space-y-0">
        {filtered.slice(0, 50).map((event) => (
          <div key={event.eventId} className="group flex items-start gap-2.5 border-b border-[var(--border-subtle)] py-2 last:border-0">
            <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--text-primary)] truncate">{event.title}</div>
              <div className="text-2xs text-[var(--text-muted)] truncate">{event.message}</div>
              <div className="mt-0.5 flex items-center gap-2 text-3xs text-[var(--text-muted)]">
                <span>{event.phase}</span><span>{event.timestamp}</span>
              </div>
            </div>
            <button
              onClick={() => { void navigator.clipboard.writeText(`[${event.phase}] ${event.title}\n${event.message}`); toast.success('已复制'); }}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <Copy size={11} />
            </button>
          </div>
        ))}
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-[var(--text-muted)]">{events.length === 0 ? '等待事件...' : '无匹配结果'}</div>
        ) : null}
      </div>
    </div>
  );
};

// ── Context Panel ────────────────────────────────────────────────

const ContextPanel = ({
  snapshot, events, agentFlow, readOnly,
}: { snapshot: WorkflowSnapshot; events: WorkflowEvent[]; agentFlow: ReturnType<typeof useAgentFlow>; readOnly: boolean }) => {
  const [activeTab, setActiveTab] = useState<'files' | 'output' | 'timeline' | 'operator'>('output');

  const touchedFiles = useMemo(() => {
    const files = new Set<string>();
    events.forEach((event) => {
      getActivityTrace(event.details).forEach((item) => {
        if (item.toolName === 'Write' || item.toolName === 'Edit' || item.toolName === 'Read') {
          const filePath = item.input?.split('\n')[0]?.replace(/^(file|path):\s*/i, '');
          if (filePath) files.add(filePath);
        }
      });
    });
    return files;
  }, [events]);

  const outputEntries = useMemo(
    () => events.slice(0, 5).flatMap((event) => getDetailEntries(event.details, { excludeKeys: ['activityTrace'] }).slice(0, 3)),
    [events]
  );

  const tabs = [
    { id: 'files' as const, label: '文件', icon: FileText },
    { id: 'output' as const, label: '输出', icon: SlidersHorizontal },
    { id: 'timeline' as const, label: '时间线', icon: Search },
    { id: 'operator' as const, label: '控制', icon: SlidersHorizontal },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--surface-sidebar)]">
      <div className="flex border-b border-[var(--border-subtle)]">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-1 px-2 py-2.5 text-xs transition ${activeTab === tab.id ? 'border-b border-[var(--text-primary)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={12} />{tab.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === 'files' ? (
          touchedFiles.size > 0 ? (
            <div className="space-y-0">
              {[...touchedFiles].map((file) => (
                <div key={file} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition">
                  <FileText size={11} className="text-[var(--text-muted)]" />
                  <span className="truncate font-mono text-2xs">{file}</span>
                </div>
              ))}
            </div>
          ) : <div className="py-8 text-center text-sm text-[var(--text-muted)]">暂无文件</div>
        ) : null}

        {activeTab === 'output' ? (
          outputEntries.length > 0 ? (
            <div className="space-y-2">
              {outputEntries.map((entry) => (
                <div key={entry.key} className="rounded bg-[var(--surface-overlay)] px-3 py-2">
                  <div className="text-2xs text-[var(--text-muted)]">{entry.label}</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-2xs leading-4 text-[var(--text-secondary)]">{snippet(entry.value, 400)}</pre>
                </div>
              ))}
            </div>
          ) : <div className="py-8 text-center text-sm text-[var(--text-muted)]">等待输出数据...</div>
        ) : null}

        {activeTab === 'timeline' ? <TimelineTab events={events} /> : null}
        {activeTab === 'operator' ? <OperatorTab snapshot={snapshot} agentFlow={agentFlow} readOnly={readOnly} /> : null}
      </div>
    </div>
  );
};

// ── Bottom Input Area ────────────────────────────────────────────

const BottomInputArea = ({
  prompt, setPrompt, onStart, disabled, isWorking,
}: { prompt: string; setPrompt: (v: string) => void; onStart: () => void; disabled: boolean; isWorking: boolean }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onStart(); }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-4">
      <div className="mx-auto flex max-w-[720px] items-end gap-3 rounded-2xl bg-[var(--surface-elevated)] px-4 py-3 shadow-sm">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Ctrl+Enter 发送)"
          className="flex-1 bg-transparent text-sm leading-6 text-[var(--text-primary)] outline-none resize-none min-h-[28px] max-h-[200px] placeholder:text-[var(--text-muted)]"
          rows={1}
        />
        <button
          onClick={onStart}
          disabled={disabled || isWorking || !prompt.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-overlay)] text-[var(--text-primary)] transition hover:bg-[var(--surface-input)] disabled:opacity-30"
          data-send-button
        >
          {isWorking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
};

// ── Recovery Bar ─────────────────────────────────────────────────

const RecoveryBar = ({ snapshot, agentFlow }: { snapshot: WorkflowSnapshot; agentFlow: ReturnType<typeof useAgentFlow> }): JSX.Element | null => {
  const { refreshSessions } = useSessions();
  const [pending, setPending] = useState<string | null>(null);

  const isPaused = snapshot.lifecycle === 'paused' && !snapshot.manualInterventionRequired;
  const isCircuitBreaker = snapshot.lifecycle === 'paused' && Boolean(snapshot.manualInterventionRequired) && Boolean(snapshot.circuitBreaker);
  const isNeedsReview = snapshot.lifecycle === 'needs_review';
  const isFailed = snapshot.lifecycle === 'failed' && Boolean(snapshot.runId);
  const isInterrupted = isPaused || isCircuitBreaker || isNeedsReview || isFailed;

  if (!isInterrupted) return null;

  const handle = async (action: () => Promise<WorkflowSnapshot>, label: string) => {
    if (!agentFlow || pending) return;
    setPending(label);
    try { await action(); toast.success(`${label}成功`); void refreshSessions(); }
    catch (error) { toast.error(toErrorMessage(error)); }
    finally { setPending(null); }
  };

  const barClass = "mx-auto max-w-[720px] flex items-center gap-3 rounded-lg bg-[var(--surface-elevated)] px-4 py-2.5";

  if (isNeedsReview) {
    return (
      <div className="px-4 pt-3">
        <div className={barClass}>
          <AlertTriangle size={14} className="text-[var(--text-muted)] shrink-0" />
          <div className="min-w-0 flex-1"><div className="text-sm text-[var(--text-primary)]">等待人工审核</div></div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => void handle(() => agentFlow!.manualApprove(), '通过')} disabled={Boolean(pending)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-40">{pending === '通过' ? <Loader2 size={12} className="animate-spin" /> : '通过'}</button>
            <button onClick={() => void handle(() => agentFlow!.manualReject(), '拒绝')} disabled={Boolean(pending)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition disabled:opacity-40">{pending === '拒绝' ? <Loader2 size={12} className="animate-spin" /> : '拒绝'}</button>
          </div>
        </div>
      </div>
    );
  }

  if (isCircuitBreaker) {
    return (
      <div className="px-4 pt-3">
        <div className={barClass}>
          <XCircle size={14} className="text-[var(--text-muted)] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-[var(--text-primary)]">熔断器触发</div>
            {snapshot.circuitBreaker?.reason ? <div className="text-xs text-[var(--text-muted)]">{snapshot.circuitBreaker.reason}</div> : null}
          </div>
          <button onClick={() => void handle(() => agentFlow!.retryCurrentStep(), '重试')} disabled={Boolean(pending)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-40">{pending === '重试' ? <Loader2 size={12} className="animate-spin" /> : '重试'}</button>
        </div>
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="px-4 pt-3">
        <div className={barClass}>
          <Pause size={14} className="text-[var(--text-muted)] shrink-0" />
          <div className="min-w-0 flex-1"><div className="text-sm text-[var(--text-primary)]">工作流已暂停</div></div>
          <button onClick={() => void handle(() => agentFlow!.resumeWorkflow(), '继续')} disabled={Boolean(pending)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-40">{pending === '继续' ? <Loader2 size={12} className="animate-spin" /> : '继续'}</button>
        </div>
      </div>
    );
  }

  if (isFailed) {
    return (
      <div className="px-4 pt-3">
        <div className={barClass}>
          <XCircle size={14} className="text-[var(--text-muted)] shrink-0" />
          <div className="min-w-0 flex-1"><div className="text-sm text-[var(--text-primary)]">工作流失败</div></div>
          {snapshot.runId ? (
            <button onClick={() => void handle(() => agentFlow!.resumeSession(snapshot.runId!), '恢复')} disabled={Boolean(pending)} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-40">{pending === '恢复' ? <Loader2 size={12} className="animate-spin" /> : '恢复'}</button>
          ) : null}
        </div>
      </div>
    );
  }

  return null;
};

// ── Main Chat View ───────────────────────────────────────────────

export const ChatView = (): JSX.Element => {
  const agentFlow = useAgentFlow();
  const { inspectSession } = useSessions();

  const prompt = useWorkflowStore((s) => s.prompt);
  const setPrompt = useWorkflowStore((s) => s.setPrompt);
  const snapshot = useWorkflowStore((s) => s.inspectedSession?.snapshot ?? s.snapshot);
  const events = useWorkflowStore((s) => s.displayedEvents);
  const sessions = useWorkflowStore((s) => s.sessions);
  const queueSnapshot = useWorkflowStore((s) => s.queueSnapshot);
  const historyQuery = useUIStore((s) => s.historyQuery);
  const contextPanelOpen = useUIStore((s) => s.contextPanelOpen);
  const setContextPanelOpen = useUIStore((s) => s.setContextPanelOpen);
  const isInspectingHistory = useWorkflowStore((s) => s.isInspectingHistory);
  const isWorking = snapshot.lifecycle === 'running';
  const items = useMemo(() => flattenActivityTrace(events), [events]);

  const handleStart = async () => {
    const finalPrompt = prompt.trim();
    if (!finalPrompt) { toast.error('请输入消息'); return; }
    setPrompt('');
    if (!agentFlow) { toast.error('未连接桥接'); return; }

    try {
      const currentRunId = snapshot.runId;
      const canContinue = currentRunId && (snapshot.lifecycle === 'completed' || snapshot.lifecycle === 'failed' || snapshot.lifecycle === 'paused');

      let nextSnapshot: WorkflowSnapshot;

      if (canContinue) {
        nextSnapshot = await agentFlow.continueAgentFlow(currentRunId, finalPrompt);
      } else {
        nextSnapshot = await agentFlow.invokeAgentFlow(finalPrompt);
      }

      if (nextSnapshot.lifecycle === 'queued') {
        useUIStore.getState().setHistoryDialogOpen(true);
        toast('已入队', { icon: '⏳' });
        return;
      }

      if (canContinue) {
        useWorkflowStore.getState().setSnapshot(nextSnapshot);
      } else {
        useWorkflowStore.getState().resetForNewRun(nextSnapshot);
      }
    } catch (error) { toast.error(toErrorMessage(error)); }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const autoScrollEnabled = usePreferenceStore((s) => s.autoScrollEnabled);

  useEffect(() => {
    if (!autoScrollEnabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 200) { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollButton(false); }
    else { setShowScrollButton(true); }
  }, [items.length, autoScrollEnabled]);

  const scrollToBottom = useCallback(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); setShowScrollButton(false); }, []);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    setShowScrollButton(container.scrollHeight - container.scrollTop - container.clientHeight > 300);
  }, []);

  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  const filteredSessions = useMemo(
    () => sessions.filter((s) => {
      const q = historyQuery.trim().toLowerCase();
      if (!q) return true;
      return [s.title, s.promptPreview, s.latestMessage, s.sessionId].join(' ').toLowerCase().includes(q);
    }),
    [sessions, historyQuery]
  );

  const groupedTurns = useMemo(() => {
    const turns: { phase?: string; items: WorkflowActivityItem[] }[] = [];
    let currentGroup: WorkflowActivityItem[] = [];
    let currentSource = '';
    items.forEach((item) => {
      if (item.source !== currentSource && currentGroup.length > 0) { turns.push({ items: currentGroup }); currentGroup = []; }
      currentSource = item.source;
      currentGroup.push(item);
    });
    if (currentGroup.length > 0) turns.push({ items: currentGroup });
    return turns;
  }, [items]);

  return (
    <div className="flex h-full overflow-hidden">
      <div className={`${sidebarOpen ? 'flex' : 'hidden'} md:flex`}>
        <ResizablePanel side="left" defaultSize={280} minSize={200} maxSize={400} storageKey="chat-sidebar-width">
          <ChatSidebar
            sessions={filteredSessions}
            activeRunId={queueSnapshot?.activeSessionId ?? snapshot.runId}
            onInspect={(sessionId) => void inspectSession(sessionId)}
            onNewChat={() => { useWorkflowStore.getState().setInspectedSession(null); useWorkflowStore.getState().setSnapshot({ ...snapshot, userPrompt: '' }); setPrompt(''); }}
          />
        </ResizablePanel>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] transition" title="切换侧边栏">
              <PanelRight size={15} className={sidebarOpen ? 'rotate-180' : ''} />
            </button>
            {snapshot.userPrompt ? (
              <span className="truncate text-sm text-[var(--text-primary)]">{snippet(snapshot.userPrompt, 60)}</span>
            ) : (
              <span className="text-sm text-[var(--text-muted)]">新对话</span>
            )}
          </div>
          <button onClick={() => setContextPanelOpen(!contextPanelOpen)} className="rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] transition">
            {contextPanelOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
          </button>
        </div>

        <div className="px-4 pt-3">
          <RecoveryBar snapshot={snapshot} agentFlow={agentFlow} />
        </div>

        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[720px] px-4 py-6 space-y-6">
            {snapshot.userPrompt ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--surface-elevated)] px-4 py-3 text-sm text-[var(--text-primary)]">
                  <MarkdownRenderer content={snapshot.userPrompt} />
                </div>
              </div>
            ) : null}

            {groupedTurns.map((turn, i) => (
              <AgentTurn key={i} items={turn.items} phase={turn.phase} />
            ))}

            {isWorking ? (
              <div className="flex items-center gap-2 text-2xs text-[var(--text-muted)]">
                <div className="flex gap-1">
                  <div className="h-1 w-1 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="h-1 w-1 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="h-1 w-1 rounded-full bg-[var(--text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                思考中...
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {showScrollButton ? (
          <button onClick={scrollToBottom} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-full bg-[var(--surface-elevated)] border border-[var(--border-subtle)] px-3 py-1 text-2xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">
            <ChevronDown size={11} />新消息
          </button>
        ) : null}

        <BottomInputArea prompt={prompt} setPrompt={setPrompt} onStart={() => void handleStart()} disabled={!agentFlow} isWorking={isWorking} />
      </div>

      <div className={`${contextPanelOpen ? 'flex' : 'hidden'}`}>
        <ResizablePanel side="right" defaultSize={280} minSize={200} maxSize={400} storageKey="chat-context-panel-width">
          <ContextPanel snapshot={snapshot} events={events} agentFlow={agentFlow} readOnly={isInspectingHistory} />
        </ResizablePanel>
      </div>
    </div>
  );
};
