import React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from 'reactflow';
import type { WorkflowNodeStatus } from '../shared/ipc';

export interface WorkflowCanvasNodeData {
  title: string; message: string; phase: string; status: WorkflowNodeStatus;
  stepId: number; retryCount: number; timestamp: string; command?: string; details?: Record<string, unknown>;
}

const StatusNode = React.memo(({ data, selected }: NodeProps<WorkflowCanvasNodeData>): JSX.Element => (
  <div className={`react-flow__node-status min-w-[220px] max-w-[280px] rounded-md border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2.5 transition-all ${selected ? 'ring-1 ring-[var(--border-muted)]' : ''}`}>
    <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border !border-[var(--border-subtle)] !bg-[var(--text-muted)]" />
    <div className="mb-1.5 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-2xs text-[var(--text-muted)]">{data.phase}</div>
        <h3 className="mt-0.5 text-xs font-medium text-[var(--text-primary)] truncate">{data.title}</h3>
      </div>
    </div>
    <p className="text-2xs leading-4 text-[var(--text-secondary)] line-clamp-2">{data.message}</p>
    {data.command ? <div className="mt-1 truncate font-mono text-3xs text-[var(--text-muted)]">{data.command}</div> : null}
    <div className="mt-1.5 flex items-center justify-between text-3xs font-mono text-[var(--text-muted)]">
      <span>Step {data.stepId}</span>
      <span>{data.retryCount > 0 ? `${data.retryCount}r` : ''}</span>
    </div>
    <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border !border-[var(--border-subtle)] !bg-[var(--text-muted)]" />
  </div>
));

const nodeTypes = { status: StatusNode };

interface InnerCanvasProps {
  nodes: Node<WorkflowCanvasNodeData>[]; edges: Edge[]; selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onNodeContextMenu: (event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => void;
}

const InnerCanvas = ({ nodes, edges, selectedNodeId, onSelectNode, onNodeContextMenu }: InnerCanvasProps): JSX.Element => {
  const flowInstance = useRef<ReactFlowInstance | null>(null);
  const { fitView } = useReactFlow();
  const selectedNode = useMemo(() => nodes.find((node) => node.id === selectedNodeId), [nodes, selectedNodeId]);

  useEffect(() => {
    if (selectedNode && flowInstance.current) {
      const { x, y } = selectedNode.position;
      flowInstance.current.setCenter(x + 150, y + 50, { zoom: 1, duration: 400 });
    }
  }, [selectedNode]);

  useEffect(() => {
    if (nodes.length > 0) { const timer = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50); return () => clearTimeout(timer); }
  }, [fitView, nodes.length]);

  const handleInit = useCallback((instance: ReactFlowInstance) => { flowInstance.current = instance; }, []);
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => { onSelectNode(node.id); }, [onSelectNode]);
  const handlePaneClick = useCallback(() => { onSelectNode(null); }, [onSelectNode]);

  return (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={handleInit}
      onNodeClick={handleNodeClick} onNodeContextMenu={onNodeContextMenu} onPaneClick={handlePaneClick}
      fitView attributionPosition="bottom-left" minZoom={0.2} maxZoom={1.5}
      defaultEdgeOptions={{ type: 'smoothstep', style: { stroke: 'var(--border-subtle)', strokeWidth: 1 } }}
    >
      <Background color="var(--border-subtle)" gap={20} size={1} />
      <Controls />
      <MiniMap nodeColor={() => 'var(--text-muted)'} maskColor="var(--bg-base)" className="!bg-[var(--surface-elevated)] !border-[var(--border-subtle)]" style={{ backgroundColor: 'var(--surface-elevated)' }} />
    </ReactFlow>
  );
};

interface WorkflowCanvasProps {
  nodes: Node<WorkflowCanvasNodeData>[]; edges: Edge[]; selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onNodeContextMenu: (event: React.MouseEvent, node: Node<WorkflowCanvasNodeData>) => void;
}

export const WorkflowCanvas = (props: WorkflowCanvasProps): JSX.Element => (
  <div className="h-full w-full">
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  </div>
);
