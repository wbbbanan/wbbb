import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import type { Node } from 'reactflow';
import {
  Pause, Play, Square, CheckCircle, XCircle, RotateCcw, Focus, ChevronLeft, MoreHorizontal, Copy, Download,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useAgentFlow } from '../../hooks/useAgentFlow';
import { useSessions } from '../../hooks/useSessions';
import { WorkflowCanvas, type WorkflowCanvasNodeData } from '../../components/WorkflowCanvas';
import { ActivityTraceCard, DetailCard } from '../../components/DisplayCards';
import { getActivityTrace, getDetailEntries, toErrorMessage } from '../../lib/format';
import { secondaryButtonClass, isSessionResumable } from '../../lib/constants';
import toast from 'react-hot-toast';

const NodeContextMenu = ({
  x, y, nodeData, onClose, onRetry, onExportNode,
}: {
  x: number; y: number; nodeData: WorkflowCanvasNodeData;
  onClose: () => void; onRetry: () => void; onExportNode: () => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const items = [
    { label: 'Copy node ID', icon: Copy, action: () => { void navigator.clipboard.writeText(nodeData.phase + '-' + nodeData.stepId); onClose(); } },
    { label: 'Copy message', icon: Copy, action: () => { void navigator.clipboard.writeText(nodeData.message); onClose(); } },
    { label: 'Export JSON', icon: Download, action: () => { onExportNode(); onClose(); } },
    ...(nodeData.status === 'error' ? [{ label: 'Retry', icon: RotateCcw, action: () => { onRetry(); onClose(); } }] : []),
  ];

  return (
    <div ref={menuRef} className="fixed z-50 min-w-[160px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] py-1 shadow-lg" style={{ left: x, top: y }}>
      <div className="px-3 py-1 text-2xs text-[var(--text-muted)]">{nodeData.title}</div>
      <div className="border-t border-[var(--border-subtle)] my-0.5" />
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.label} onClick={item.action} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-overlay)] transition">
            <Icon size={12} />{item.label}
          </button>
        );
      })}
    </div>
  );
};

export const DagView = (): JSX.Element => {
  const agentFlow = useAgentFlow();
  const { refreshSessions } = useSessions();
  const snapshot = useWorkflowStore((s) => s.inspectedSession?.snapshot ?? s.snapshot);
  const graph = useWorkflowStore((s) => s.displayedGraph);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const followLatestNode = useWorkflowStore((s) => s.followLatestNode);
  const isInspectingHistory = useWorkflowStore((s) => s.isInspectingHistory);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    useWorkflowStore.getState().setSelectedNodeId(nodeId ?? '');
    if (nodeId === null) useWorkflowStore.getState().setSelectedNodeId(null as unknown as string);
  }, []);

  const handleFollowLatest = useCallback(() => { useWorkflowStore.getState().followLatest(); }, []);

  const canControlRealtimeWorkflow = Boolean(agentFlow) && !isInspectingHistory;
  const canPause = canControlRealtimeWorkflow && snapshot.lifecycle === 'running';
  const canResume = canControlRealtimeWorkflow && snapshot.lifecycle === 'paused' && !snapshot.manualInterventionRequired;
  const canCancel = canControlRealtimeWorkflow && (snapshot.lifecycle === 'running' || canResume);
  const canManualApprove = canControlRealtimeWorkflow && snapshot.lifecycle === 'needs_review';

  const selectedNode = useMemo(() => (selectedNodeId ? graph.nodes.find((node) => node.id === selectedNodeId) : null) as Node<WorkflowCanvasNodeData> | undefined | null, [graph.nodes, selectedNodeId]);
  const selectedNodeActivityTrace = useMemo(() => getActivityTrace(selectedNode?.data.details), [selectedNode]);
  const selectedNodeDetails = useMemo(() => getDetailEntries(selectedNode?.data.details, { excludeKeys: ['activityTrace'] }), [selectedNode]);

  const handleAction = async (action: () => Promise<unknown>, successMessage: string) => {
    try { await action(); toast.success(successMessage); void refreshSessions(); }
    catch (error) { toast.error(toErrorMessage(error)); }
  };

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: Node<WorkflowCanvasNodeData> } | null>(null);
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => { event.preventDefault(); setCtxMenu({ x: event.clientX, y: event.clientY, node }); }, []);
  const handleExportNode = useCallback(() => {
    if (!ctxMenu) return;
    const blob = new Blob([JSON.stringify(ctxMenu.node.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `node-${ctxMenu.node.data.phase}-${ctxMenu.node.data.stepId}.json`; a.click(); URL.revokeObjectURL(url);
  }, [ctxMenu]);
  const handleRetryFromMenu = useCallback(() => { if (agentFlow) void handleAction(() => agentFlow.retryCurrentStep(), 'Retrying...'); }, [agentFlow]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)]">
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2">
        <div className="flex items-center gap-3">
          <h2 className="text-sm text-[var(--text-primary)]">{isInspectingHistory ? '会话回放' : '流程图'}</h2>
          <span className="font-mono text-2xs text-[var(--text-muted)]">{snapshot.runId ? `运行 ${snapshot.runId.slice(0, 8)}` : '无运行中'}</span>
        </div>
        <div className="flex items-center gap-1">
          {canPause ? <button onClick={() => void handleAction(() => agentFlow!.pauseWorkflow(), '已暂停')} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${secondaryButtonClass}`}><Pause size={12} />暂停</button> : null}
          {canResume ? <button onClick={() => void handleAction(() => agentFlow!.resumeWorkflow(), '已恢复')} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${secondaryButtonClass}`}><Play size={12} />继续</button> : null}
          {canCancel ? <button onClick={() => void handleAction(() => agentFlow!.cancelWorkflow(), '已取消')} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"><Square size={12} />取消</button> : null}
          {canManualApprove ? <><button onClick={() => void handleAction(() => agentFlow!.manualApprove(), '已通过')} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${secondaryButtonClass}`}><CheckCircle size={12} />通过</button><button onClick={() => void handleAction(() => agentFlow!.manualReject(), '已拒绝')} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"><XCircle size={12} />拒绝</button></> : null}
          <button onClick={handleFollowLatest} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${secondaryButtonClass}`} disabled={!graph.lastNodeId}><Focus size={12} />{isInspectingHistory ? '实时' : followLatestNode ? '跟随中' : '跟随'}</button>
          {selectedNode ? <button onClick={() => handleSelectNode(null)} className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${secondaryButtonClass}`}><ChevronLeft size={12} />返回</button> : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkflowCanvas nodes={graph.nodes} edges={graph.edges} selectedNodeId={selectedNodeId} onSelectNode={handleSelectNode} onNodeContextMenu={handleNodeContextMenu} />
        </div>
        {selectedNode ? (
          <section className="grid max-h-[40vh] min-h-[200px] grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-0 overflow-hidden border-t border-[var(--border-subtle)] bg-[var(--bg-base)]">
            <div className="overflow-y-auto border-r border-[var(--border-subtle)] px-4 py-3">
              <div className="flex items-start justify-between">
                <div><div className="text-2xs text-[var(--text-muted)]">节点</div><h3 className="mt-0.5 text-sm text-[var(--text-primary)]">{selectedNode.data.title}</h3></div>
                <button onClick={() => handleSelectNode(null)} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-elevated)] transition"><ChevronLeft size={14} /></button>
              </div>
              <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                <div>阶段: {selectedNode.data.phase}</div><div>步骤: {selectedNode.data.stepId}</div><div>重试: {selectedNode.data.retryCount}</div>
                <div className="font-mono text-2xs text-[var(--text-muted)]">{selectedNode.data.timestamp}</div>
              </div>
              {selectedNode.data.command ? (
                <div className="mt-2 rounded bg-[var(--surface-overlay)] px-2.5 py-2">
                  <div className="text-2xs text-[var(--text-muted)] mb-1">命令</div>
                  <pre className="whitespace-pre-wrap font-mono text-2xs leading-4 text-[var(--text-secondary)]">{selectedNode.data.command}</pre>
                </div>
              ) : null}
            </div>
            <div className="min-w-0 overflow-y-auto px-4 py-3">
              <div className="space-y-3">
                <div><div className="text-2xs text-[var(--text-muted)] mb-1">消息</div><div className="whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{selectedNode.data.message}</div></div>
                {selectedNodeActivityTrace.length > 0 ? <section className="space-y-1"><div className="text-2xs text-[var(--text-muted)]">追踪</div>{selectedNodeActivityTrace.map((item) => <ActivityTraceCard key={item.id} item={item} />)}</section> : null}
                {selectedNodeDetails.length > 0 ? <section className="space-y-2"><div className="text-2xs text-[var(--text-muted)]">详情</div>{selectedNodeDetails.map((entry) => <DetailCard key={entry.key} label={entry.label} value={entry.value} />)}</section> : selectedNodeActivityTrace.length === 0 ? <p className="text-sm text-[var(--text-muted)]">无详情</p> : null}
              </div>
            </div>
          </section>
        ) : null}
      </div>

      {ctxMenu ? <NodeContextMenu x={ctxMenu.x} y={ctxMenu.y} nodeData={ctxMenu.node.data} onClose={() => setCtxMenu(null)} onRetry={handleRetryFromMenu} onExportNode={handleExportNode} /> : null}
    </div>
  );
};
