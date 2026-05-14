import { MarkerType, type Edge, type Node } from 'reactflow';
import dagre from '@dagrejs/dagre';
import type { WorkflowEvent } from '../shared/ipc';
import type { WorkflowCanvasNodeData } from '../components/WorkflowCanvas';

export type GraphState = {
  nodes: Node<WorkflowCanvasNodeData>[];
  edges: Edge[];
  lastNodeId: string | null;
};

export const initialGraphState: GraphState = {
  nodes: [],
  edges: [],
  lastNodeId: null,
};

const buildEdge = (source: string, target: string, status: WorkflowEvent['status']): Edge => {
  const color =
    status === 'error' ? '#fb7185' : status === 'warning' ? '#fbbf24' : status === 'paused' ? '#e879f9' : '#38bdf8';

  return {
    id: `${source}->${target}`,
    source,
    target,
    animated: true,
    type: 'smoothstep',
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color,
      width: 18,
      height: 18,
    },
  };
};

/** Build a node from a workflow event (position will be set by dagre). */
const buildNode = (event: WorkflowEvent): Node<WorkflowCanvasNodeData> => ({
  id: event.nodeId,
  type: 'status',
  draggable: false,
  position: { x: 0, y: 0 },
  data: {
    title: event.title,
    message: event.message,
    phase: event.phase,
    status: event.status,
    stepId: event.stepId,
    retryCount: event.retryCount,
    timestamp: event.timestamp,
    command: event.command,
    details: event.details ?? (event.activityTrace ? { activityTrace: event.activityTrace } : undefined),
  },
});

/** Apply dagre auto-layout to nodes and edges. */
export const applyDagreLayout = (
  nodes: Node<WorkflowCanvasNodeData>[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): Node<WorkflowCanvasNodeData>[] => {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });

  const nodeWidth = 300;
  const nodeHeight = 160;

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
  });
};

/** Upsert a single event into graph state (no layout). */
const upsertEvent = (current: GraphState, event: WorkflowEvent): GraphState => {
  const nextNode = buildNode(event);
  const existingNodeIndex = current.nodes.findIndex((node) => node.id === event.nodeId);
  const nodes = [...current.nodes];

  if (existingNodeIndex >= 0) {
    nodes[existingNodeIndex] = nextNode;
  } else {
    nodes.push(nextNode);
  }

  const edges = [...current.edges];
  const sourceNodeId = current.lastNodeId;

  if (sourceNodeId && sourceNodeId !== event.nodeId) {
    const edgeId = `${sourceNodeId}->${event.nodeId}`;
    if (!edges.some((edge) => edge.id === edgeId)) {
      edges.push(buildEdge(sourceNodeId, event.nodeId, event.status));
    }
  }

  return { nodes, edges, lastNodeId: event.nodeId };
};

/** Add an event to the graph state and apply layout. */
export const applyEventToGraph = (current: GraphState, event: WorkflowEvent): GraphState => {
  const next = upsertEvent(current, event);
  return { ...next, nodes: applyDagreLayout(next.nodes, next.edges) };
};

/** Build full graph from a list of events. */
export const buildGraphFromEvents = (sourceEvents: WorkflowEvent[]): GraphState => {
  if (!Array.isArray(sourceEvents) || sourceEvents.length === 0) return initialGraphState;

  let state = initialGraphState;
  for (const event of sourceEvents) {
    if (!event || !event.nodeId) continue;
    try {
      state = upsertEvent(state, event);
    } catch {
      // Skip malformed events
    }
  }

  return { ...state, nodes: applyDagreLayout(state.nodes, state.edges) };
};
