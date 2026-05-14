import { useState } from 'react';
import { Search, RotateCcw, Eye, Download, MoreHorizontal, Play, Clock, DollarSign, AlertTriangle } from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUIStore } from '../../store/uiStore';
import { useAgentFlow } from '../../hooks/useAgentFlow';
import { useSessions } from '../../hooks/useSessions';
import { lifecycleLabel, sessionLifecycleTone, sessionExecutionStateLabel, sessionExecutionStateTone, isSessionResumable } from '../../lib/constants';
import type { WorkflowSessionSummary } from '../../shared/ipc';
import toast from 'react-hot-toast';

const exportSession = async (sessionId: string, format: 'json' | 'md', agentFlow: ReturnType<typeof useAgentFlow>) => {
  if (!agentFlow) { toast.error('桥接未连接'); return; }
  try {
    const payload = await agentFlow.exportSession(sessionId, format);
    const blob = new Blob([payload.content], { type: payload.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = payload.fileName; a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${payload.fileName}`);
  } catch (error) { toast.error(String(error)); }
};

const SessionRow = ({
  session, isActive, onInspect, onResume, onExport,
}: {
  session: WorkflowSessionSummary; isActive: boolean;
  onInspect: () => void; onResume: () => void; onExport: (format: 'json' | 'md') => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={`group flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3 transition hover:bg-[var(--surface-elevated)] ${isActive ? 'bg-[var(--surface-overlay)]' : ''}`}>
      <div className="mt-1.5 shrink-0"><div className="h-1.5 w-1.5 rounded-full bg-[var(--text-muted)]" /></div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm text-[var(--text-primary)]">{session.title}</h3>
          <span className={`shrink-0 text-2xs ${sessionLifecycleTone(session.lifecycle)}`}>{lifecycleLabel(session.lifecycle)}</span>
          <span className={`shrink-0 rounded px-1 py-0.5 text-3xs ${sessionExecutionStateTone(session.executionState)}`}>{sessionExecutionStateLabel(session.executionState)}</span>
          {isActive ? <span className="shrink-0 rounded bg-[var(--surface-overlay)] px-1 py-0.5 text-3xs text-[var(--text-secondary)]">运行中</span> : null}
        </div>
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{session.promptPreview || 'No preview'}</p>
        <div className="mt-2 flex items-center gap-4 text-2xs text-[var(--text-muted)]">
          <span className="flex items-center gap-1"><Clock size={10} />Step {session.currentStepId || '-'}</span>
          <span className="flex items-center gap-1"><DollarSign size={10} />${session.metrics.totalCostUsd.toFixed(3)}</span>
          {session.metrics.warningCount > 0 || session.metrics.errorCount > 0 ? <span className="flex items-center gap-1"><AlertTriangle size={10} />{session.metrics.warningCount}/{session.metrics.errorCount}</span> : null}
        </div>
      </div>
      <div className="relative shrink-0">
        <button onClick={() => setMenuOpen(!menuOpen)} className="rounded p-1 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition hover:bg-[var(--surface-overlay)]"><MoreHorizontal size={13} /></button>
        {menuOpen ? (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-7 z-40 min-w-[140px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] py-1 shadow-lg">
              <button onClick={() => { onInspect(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition"><Eye size={12} />查看</button>
              {isSessionResumable(session) ? <button onClick={() => { onResume(); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition"><Play size={12} />恢复</button> : null}
              <button onClick={() => { onExport('json'); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition"><Download size={12} />JSON</button>
              <button onClick={() => { onExport('md'); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition"><Download size={12} />Markdown</button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

export const SessionView = (): JSX.Element => {
  const agentFlow = useAgentFlow();
  const sessions = useWorkflowStore((s) => s.sessions);
  const queueSnapshot = useWorkflowStore((s) => s.queueSnapshot);
  const snapshot = useWorkflowStore((s) => s.snapshot);
  const historyQuery = useUIStore((s) => s.historyQuery);
  const setHistoryQuery = useUIStore((s) => s.setHistoryQuery);
  const { inspectSession, resumeSession, refreshSessions } = useSessions();
  const activeRunId = queueSnapshot?.activeSessionId ?? snapshot.runId;

  const filtered = sessions.filter((s) => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return true;
    return [s.title, s.promptPreview, s.latestMessage, s.sessionId].join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-base)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-6 py-3">
        <div><h1 className="text-base text-[var(--text-primary)]">历史</h1><p className="text-xs text-[var(--text-muted)]">浏览历史会话</p></div>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1"><Clock size={12} />{queueSnapshot?.queuedSessionIds.length ?? 0} 排队</span>
          <span className="flex items-center gap-1"><RotateCcw size={12} />{queueSnapshot?.scheduledSessionIds.length ?? 0} 定时</span>
          <span className="flex items-center gap-1"><Eye size={12} />{sessions.length} 总计</span>
        </div>
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-6 py-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="搜索会话..." className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-input)] py-1.5 pl-8 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]" />
        </div>
        <button onClick={() => void refreshSessions()} className="flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition"><RotateCcw size={12} />刷新</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="rounded-full bg-[var(--surface-elevated)] p-3"><Search size={20} className="text-[var(--text-muted)]" /></div>
            <p className="mt-3 text-sm text-[var(--text-muted)]">{sessions.length === 0 ? '暂无会话' : '无匹配'}</p>
          </div>
        ) : (
          <div>{filtered.map((s) => (
            <SessionRow key={s.sessionId} session={s} isActive={activeRunId === s.runId}
              onInspect={() => { void inspectSession(s.sessionId); useUIStore.getState().setRoute('chat'); }}
              onResume={() => void resumeSession(s.sessionId)}
              onExport={(format) => void exportSession(s.sessionId, format, agentFlow)}
            />
          ))}</div>
        )}
      </div>
    </div>
  );
};
