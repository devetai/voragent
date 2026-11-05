import type { ProviderState, Task, VEvent } from '@voragent/shared';

export type NodeType = 'provider' | 'task' | 'file' | 'handoff';

export type EdgeType = 'assigned_to' | 'modified' | 'read' | 'handoff_to';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  subLabel?: string;
  color: string;
  icon: string;
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  data: {
    task?: Task;
    provider?: ProviderState;
    filePath?: string;
    readCount?: number;
    editCount?: number;
    handoffFrom?: string;
    handoffTo?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
  color: string;
  dashed?: boolean;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphFilterState {
  showProviders: boolean;
  showTasks: boolean;
  showFiles: boolean;
  showHandoffs: boolean;
  searchQuery: string;
}

export const DEFAULT_GRAPH_FILTER: GraphFilterState = {
  showProviders: true,
  showTasks: true,
  showFiles: true,
  showHandoffs: true,
  searchQuery: '',
};

export const NODE_COLORS: Record<NodeType, { base: string; border: string; bg: string }> = {
  provider: { base: '#D97757', border: '#B45309', bg: '#FFFBEB' },
  task:     { base: '#2563EB', border: '#1D4ED8', bg: '#EFF6FF' },
  file:     { base: '#10B981', border: '#047857', bg: '#ECFDF5' },
  handoff:  { base: '#F59E0B', border: '#D97706', bg: '#FEF3C7' },
};
