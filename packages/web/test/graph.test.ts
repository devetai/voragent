import { describe, expect, it } from 'vitest';
import type { ProviderState, Task, VEvent } from '@voragent/shared';
import { extractGraphData } from '../src/graph/graphModel';
import { ForceSimulation } from '../src/graph/forceSimulation';
import type { GraphEdge, GraphNode } from '../src/graph/types';

describe('Giai đoạn 3 - Đồ thị Quan hệ Tri thức & Mô hình Lực', () => {
  const dummyProviders: ProviderState[] = [
    { id: 'claude', cooldownUntil: null, usedPercent: 45, installed: true, version: '1.0', updatedAt: 0 },
    { id: 'codex', cooldownUntil: Date.now() + 50000, usedPercent: 90, installed: true, version: '1.0', updatedAt: 0 },
  ];

  const dummyTasks: Task[] = [
    {
      id: 'task-1',
      seq: 1,
      title: 'Sửa lỗi đăng nhập OAuth',
      repoPath: '/repos/auth-app',
      workspacePath: null,
      branch: null,
      baseCommit: null,
      mode: 'head-dirty-commit',
      priority: ['claude'],
      status: 'running',
      currentProvider: 'claude',
      createdAt: 0,
      updatedAt: 0,
    },
  ];

  it('trích xuất đúng Agent Nodes, Task Nodes và cạnh assigned_to', () => {
    const eventsMap = new Map<string, VEvent[]>();
    const graph = extractGraphData(dummyTasks, dummyProviders, eventsMap);

    // 2 Provider Nodes + 1 Task Node
    expect(graph.nodes.some((n) => n.id === 'provider-claude' && n.type === 'provider')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'provider-codex' && n.type === 'provider')).toBe(true);
    expect(graph.nodes.some((n) => n.id === 'task-task-1' && n.type === 'task')).toBe(true);

    // Cạnh assigned_to từ Claude -> Task 1
    const assignEdge = graph.edges.find((e) => e.source === 'provider-claude' && e.target === 'task-task-1');
    expect(assignEdge).toBeDefined();
    expect(assignEdge?.type).toBe('assigned_to');
  });

  it('trích xuất File Nodes và quan hệ modified / read từ luồng sự kiện', () => {
    const eventsMap = new Map<string, VEvent[]>();
    eventsMap.set('task-1', [
      {
        id: 1,
        taskId: 'task-1',
        runId: 'run-1',
        ts: 100,
        source: 'managed',
        type: 'FILE_CHANGED',
        data: { path: 'src/auth/login.ts' },
      },
      {
        id: 2,
        taskId: 'task-1',
        runId: 'run-1',
        ts: 120,
        source: 'managed',
        type: 'TOOL_CALL_START',
        data: { toolName: 'Read', args: { path: 'src/config.json' } },
      },
      {
        id: 3,
        taskId: 'task-1',
        runId: 'run-1',
        ts: 150,
        source: 'managed',
        type: 'HANDOFF',
        data: { from: 'claude', to: 'codex' },
      },
    ]);

    const graph = extractGraphData(dummyTasks, dummyProviders, eventsMap);

    // Kiểm tra tạo File Nodes
    const loginNode = graph.nodes.find((n) => n.id === 'file-src/auth/login.ts');
    expect(loginNode).toBeDefined();
    expect(loginNode?.type).toBe('file');
    expect(loginNode?.data.editCount).toBe(1);

    const configNode = graph.nodes.find((n) => n.id === 'file-src/config.json');
    expect(configNode).toBeDefined();
    expect(configNode?.type).toBe('file');
    expect(configNode?.data.readCount).toBe(1);

    // Kiểm tra cạnh sửa & đọc
    const modEdge = graph.edges.find((e) => e.type === 'modified');
    expect(modEdge?.target).toBe('file-src/auth/login.ts');

    const readEdge = graph.edges.find((e) => e.type === 'read');
    expect(readEdge?.target).toBe('file-src/config.json');
    expect(readEdge?.dashed).toBe(true);

    // Kiểm tra cạnh bàn giao handoff giữa 2 agent
    const handoffEdge = graph.edges.find((e) => e.type === 'handoff_to');
    expect(handoffEdge?.source).toBe('provider-claude');
    expect(handoffEdge?.target).toBe('provider-codex');
  });

  it('mô phỏng lực vật lý: hai nút quá gần sẽ bị đẩy xa nhau', () => {
    const nodeA: GraphNode = {
      id: 'a',
      type: 'task',
      label: 'A',
      color: '#fff',
      icon: '',
      radius: 20,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      data: {},
    };
    const nodeB: GraphNode = {
      id: 'b',
      type: 'task',
      label: 'B',
      color: '#fff',
      icon: '',
      radius: 20,
      x: 5, // Rất gần A
      y: 0,
      vx: 0,
      vy: 0,
      data: {},
    };

    const sim = new ForceSimulation([nodeA, nodeB], []);
    // Chạy 5 bước tính toán
    for (let i = 0; i < 5; i++) {
      sim.tick();
    }

    const dist = Math.abs(nodeB.x - nodeA.x);
    // Khoảng cách phải tăng lên đáng kể do lực đẩy Coulomb
    expect(dist).toBeGreaterThan(15);
  });

  it('mô phỏng lực vật lý đạt trạng thái cân bằng và dừng tính toán (isStable)', () => {
    const nodeA: GraphNode = {
      id: 'a',
      type: 'task',
      label: 'A',
      color: '#fff',
      icon: '',
      radius: 20,
      x: 10,
      y: 0,
      vx: 0,
      vy: 0,
      data: {},
    };
    const nodeB: GraphNode = {
      id: 'b',
      type: 'task',
      label: 'B',
      color: '#fff',
      icon: '',
      radius: 20,
      x: 100,
      y: 0,
      vx: 0,
      vy: 0,
      data: {},
    };
    const edge: GraphEdge = {
      id: 'e',
      source: 'a',
      target: 'b',
      type: 'assigned_to',
      color: '#fff',
    };

    const sim = new ForceSimulation([nodeA, nodeB], [edge]);
    // Chạy tối đa 80 vòng lặp
    for (let i = 0; i < 80; i++) {
      sim.tick();
    }

    // Đạt ổn định, dừng tốn CPU
    expect(sim.isStable).toBe(true);
  });

  it('xác định các liên kết lân cận cho NodeDetailDrawer', () => {
    const nodeA: GraphNode = { id: 'a', type: 'task', label: 'Task A', color: '', icon: '', radius: 20, x: 0, y: 0, vx: 0, vy: 0, data: {} };
    const nodeB: GraphNode = { id: 'b', type: 'file', label: 'File B', color: '', icon: '', radius: 20, x: 50, y: 0, vx: 0, vy: 0, data: {} };
    const nodeC: GraphNode = { id: 'c', type: 'file', label: 'File C', color: '', icon: '', radius: 20, x: -50, y: 0, vx: 0, vy: 0, data: {} };

    const edges: GraphEdge[] = [
      { id: 'e1', source: 'a', target: 'b', type: 'modified', color: '' },
      { id: 'e2', source: 'a', target: 'c', type: 'read', color: '' },
    ];

    const connectedToA = edges.filter((e) => e.source === 'a' || e.target === 'a');
    expect(connectedToA.length).toBe(2);

    const connectedToB = edges.filter((e) => e.source === 'b' || e.target === 'b');
    expect(connectedToB.length).toBe(1);
    expect(connectedToB[0]?.source).toBe('a');
  });
});
