import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  WorkflowEvent,
  WorkflowSnapshot,
  WorkflowSessionSummary,
  WorkflowSessionRecord,
  WorkflowQueueSnapshot,
} from '../shared/ipc';
import { emptySnapshot } from '../lib/constants';
import { type GraphState, initialGraphState, applyEventToGraph, buildGraphFromEvents } from '../lib/graph';

interface WorkflowState {
  // ── Core state ──────────────────────────────────────────────
  snapshot: WorkflowSnapshot;
  graph: GraphState;
  events: WorkflowEvent[];
  prompt: string;

  // ── Session ─────────────────────────────────────────────────
  sessions: WorkflowSessionSummary[];
  queueSnapshot: WorkflowQueueSnapshot | null;
  inspectedSession: WorkflowSessionRecord | null;

  // ── Cached derived state (stable references) ────────────────
  displayedEvents: WorkflowEvent[];
  displayedGraph: GraphState;

  // ── Selection ───────────────────────────────────────────────
  selectedNodeId: string | null;
  followLatestNode: boolean;

  // ── Derived helpers ─────────────────────────────────────────
  isInspectingHistory: boolean;

  // ── Actions ─────────────────────────────────────────────────
  setSnapshot: (snapshot: WorkflowSnapshot) => void;
  setPrompt: (prompt: string) => void;
  addEvent: (event: WorkflowEvent) => void;
  resetForNewRun: (snapshot: WorkflowSnapshot) => void;
  setSessions: (sessions: WorkflowSessionSummary[]) => void;
  setQueueSnapshot: (queue: WorkflowQueueSnapshot) => void;
  setInspectedSession: (session: WorkflowSessionRecord | null) => void;
  setActiveSessionRecord: (record: WorkflowSessionRecord) => void;
  setSelectedNodeId: (nodeId: string | null) => void;
  setFollowLatestNode: (follow: boolean) => void;
  followLatest: () => void;
}

const reverseEvents = (events: WorkflowEvent[]): WorkflowEvent[] => {
  if (!Array.isArray(events)) return [];
  try { return [...events].reverse(); } catch { return []; }
};

export const useWorkflowStore = create<WorkflowState>()(devtools((set, get) => ({
  snapshot: emptySnapshot,
  graph: initialGraphState,
  events: [],
  prompt: '',
  sessions: [],
  queueSnapshot: null,
  inspectedSession: null,
  displayedEvents: [],
  displayedGraph: initialGraphState,
  selectedNodeId: null,
  followLatestNode: true,
  isInspectingHistory: false,

  setSnapshot: (snapshot) => set({ snapshot }),
  setPrompt: (prompt) => set({ prompt }),

  addEvent: (event) => {
    const { followLatestNode, inspectedSession } = get();
    set((state) => {
      const nextEvents = [event, ...state.events].slice(0, 200);
      // Update graph structure immediately but defer layout recalculation
      const nextGraph = applyEventToGraph(state.graph, event);
      return {
        events: nextEvents,
        graph: nextGraph,
        displayedEvents: inspectedSession ? state.displayedEvents : nextEvents,
        displayedGraph: inspectedSession ? state.displayedGraph : nextGraph,
        selectedNodeId: followLatestNode && !inspectedSession ? event.nodeId : state.selectedNodeId,
      };
    });
  },

  resetForNewRun: (snapshot) => {
    set((state) => ({
      snapshot,
      graph: initialGraphState,
      events: state.events,
      displayedEvents: state.events,
      displayedGraph: initialGraphState,
      selectedNodeId: null,
      followLatestNode: true,
      inspectedSession: null,
      isInspectingHistory: false,
    }));
  },

  setSessions: (sessions) => set({ sessions }),
  setQueueSnapshot: (queue) => set({ queueSnapshot: queue }),

  setActiveSessionRecord: (record) => {
    const sessionEvents = Array.isArray(record.events) ? record.events : [];
    let sessionGraph;
    try {
      sessionGraph = sessionEvents.length > 0 ? buildGraphFromEvents(sessionEvents) : initialGraphState;
    } catch {
      sessionGraph = initialGraphState;
    }
    set((state) => ({
      snapshot: record.snapshot,
      events: sessionEvents,
      graph: sessionGraph,
      displayedEvents: state.inspectedSession ? state.displayedEvents : reverseEvents(sessionEvents),
      displayedGraph: state.inspectedSession ? state.displayedGraph : sessionGraph,
    }));
  },

  setInspectedSession: (session) => {
    if (session) {
      const sessionEvents = Array.isArray(session.events) ? session.events : [];
      let sessionGraph: GraphState;
      try {
        sessionGraph = sessionEvents.length > 0 ? buildGraphFromEvents(sessionEvents) : initialGraphState;
      } catch {
        sessionGraph = initialGraphState;
      }
      set({
        inspectedSession: session,
        isInspectingHistory: true,
        displayedEvents: reverseEvents(sessionEvents),
        displayedGraph: sessionGraph,
        followLatestNode: false,
        selectedNodeId: null,
      });
    } else {
      set((state) => ({
        inspectedSession: null,
        isInspectingHistory: false,
        displayedEvents: state.events,
        displayedGraph: state.graph,
      }));
    }
  },

  setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId, followLatestNode: false }),

  setFollowLatestNode: (follow) => set({ followLatestNode: follow }),

  followLatest: () => {
    const { graph } = get();
    set((state) => ({
      inspectedSession: null,
      isInspectingHistory: false,
      followLatestNode: true,
      selectedNodeId: graph.lastNodeId,
      displayedEvents: state.events,
      displayedGraph: state.graph,
    }));
  },
}), { name: 'WorkflowStore' }));
