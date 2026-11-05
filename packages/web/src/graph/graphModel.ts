import type { ProviderState, Task, VEvent } from '@voragent/shared';
import type { GraphData, GraphEdge, GraphNode } from './types';

function extractFilePathFromToolCall(data: Record<string, unknown>): string | null {
  const toolName = String(data['toolName'] ?? data['name'] ?? '').toLowerCase();
  const args = (data['args'] ?? data['arguments'] ?? {}) as Record<string, unknown>;

  if (toolName.includes('read') || toolName.includes('edit') || toolName.includes('write')) {
    const rawPath = args['path'] ?? args['filePath'] ?? args['file_path'] ?? args['Path'] ?? '';
    if (typeof rawPath === 'string' && rawPath.trim()) {
      return normalizeFilePath(rawPath.trim());
    }
  }
  return null;
}

function normalizeFilePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function baseFileName(p: string): string {
  const parts = p.split('/');
  return parts.slice(-2).join('/'); // Lấy 2 cấp thư mục cuối: ví dụ src/auth.ts
}

export function extractGraphData(
  tasks: Task[],
  providers: ProviderState[],
  eventsMap: Map<string, VEvent[]>
): GraphData {
  const nodesMap = new Map<string, GraphNode>();
  const edgesMap = new Map<string, GraphEdge>();

  // 1. Tạo Provider Nodes — Chỉ hiển thị các Provider ĐÃ CÀI ĐẶT hoặc có Task thực thi thực tế
  const usedProviderIds = new Set(
    tasks.map((t) => t.currentProvider?.toLowerCase()).filter((x): x is string => Boolean(x))
  );
  const activeProviders = providers.filter(
    (p) => p.installed || usedProviderIds.has(p.id.toLowerCase())
  );

  activeProviders.forEach((p, idx) => {
    const id = `provider-${p.id}`;
    const nameLower = p.id.toLowerCase();
    let color = '#8B5CF6';
    const icon = '⚡';
    let label = p.id;

    if (nameLower.includes('claude')) {
      color = '#D97757';
      label = 'Claude Code';
    } else if (nameLower.includes('codex')) {
      color = '#10A37F';
      label = 'Codex';
    } else if (nameLower.includes('antigravity') || nameLower.includes('agy')) {
      color = '#3B82F6';
      label = 'Antigravity';
    }

    // Tọa độ khởi tạo vòng cung phía trên
    const angle = (idx / Math.max(1, activeProviders.length)) * Math.PI - Math.PI / 2;
    const r = 240;

    const subLabel = !p.installed
      ? 'Chưa cài CLI'
      : p.cooldownUntil && p.cooldownUntil > Date.now()
      ? 'Tạm nghỉ (Quota)'
      : 'Sẵn sàng';

    nodesMap.set(id, {
      id,
      type: 'provider',
      label,
      subLabel,
      color,
      icon,
      radius: 32,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r - 80,
      vx: 0,
      vy: 0,
      data: { provider: p },
    });
  });

  // Theo dõi các tệp và lượt tương tác
  const fileStats = new Map<string, { readCount: number; editCount: number; tasks: Set<string> }>();

  // 2. Tạo Task Nodes & Quét Sự Kiện
  tasks.forEach((t, idx) => {
    const taskId = `task-${t.id}`;
    let taskColor = '#2563EB';
    if (t.status === 'waiting_quota') taskColor = '#F59E0B';
    if (t.status === 'failed') taskColor = '#EF4444';
    if (t.status === 'closed') taskColor = '#10B981';

    // Tọa độ khởi tạo rải đều ở trung tâm
    const angle = (idx / Math.max(1, tasks.length)) * Math.PI * 2;
    const dist = 120 + (idx % 3) * 40;

    nodesMap.set(taskId, {
      id: taskId,
      type: 'task',
      label: `#${t.seq} ${t.title.length > 24 ? t.title.slice(0, 22) + '…' : t.title}`,
      subLabel: t.status,
      color: taskColor,
      icon: '📋',
      radius: 26,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist + 40,
      vx: 0,
      vy: 0,
      data: { task: t },
    });

    // Cạnh nối Provider -> Task
    if (t.currentProvider) {
      const pNodeId = `provider-${t.currentProvider}`;
      if (nodesMap.has(pNodeId)) {
        const edgeId = `${pNodeId}->${taskId}`;
        edgesMap.set(edgeId, {
          id: edgeId,
          source: pNodeId,
          target: taskId,
          type: 'assigned_to',
          label: 'thực thi',
          color: '#94A3B8',
        });
      }
    }

    // Quét sự kiện của task để tìm tệp và sự kiện chuyển giao
    const evs = eventsMap.get(t.id) ?? [];
    evs.forEach((ev) => {
      // 2.1 Tệp bị sửa đổi hoặc đọc
      if (ev.type === 'FILE_CHANGED') {
        const path = String(ev.data['path'] ?? '');
        if (path) {
          const norm = normalizeFilePath(path);
          const stats = fileStats.get(norm) ?? { readCount: 0, editCount: 0, tasks: new Set() };
          stats.editCount++;
          stats.tasks.add(taskId);
          fileStats.set(norm, stats);

          // Cạnh modified
          const fileNodeId = `file-${norm}`;
          const edgeId = `${taskId}-mod->${fileNodeId}`;
          edgesMap.set(edgeId, {
            id: edgeId,
            source: taskId,
            target: fileNodeId,
            type: 'modified',
            label: 'sửa',
            color: '#EA580C',
          });
        }
      } else if (ev.type === 'TOOL_CALL_START') {
        const path = extractFilePathFromToolCall(ev.data);
        if (path) {
          const isEdit = String(ev.data['toolName'] ?? '').toLowerCase().includes('edit') ||
            String(ev.data['toolName'] ?? '').toLowerCase().includes('write');
          const stats = fileStats.get(path) ?? { readCount: 0, editCount: 0, tasks: new Set() };
          if (isEdit) stats.editCount++;
          else stats.readCount++;
          stats.tasks.add(taskId);
          fileStats.set(path, stats);

          const fileNodeId = `file-${path}`;
          const edgeId = `${taskId}-${isEdit ? 'mod' : 'read'}->${fileNodeId}`;
          edgesMap.set(edgeId, {
            id: edgeId,
            source: taskId,
            target: fileNodeId,
            type: isEdit ? 'modified' : 'read',
            label: isEdit ? 'sửa' : 'đọc',
            color: isEdit ? '#EA580C' : '#10B981',
            dashed: !isEdit,
          });
        }
      } else if (ev.type === 'HANDOFF') {
        // Sự kiện bàn giao quota giữa 2 provider
        const from = String(ev.data['from'] ?? '');
        const to = String(ev.data['to'] ?? '');
        if (from && to) {
          const fromNodeId = `provider-${from}`;
          const toNodeId = `provider-${to}`;
          if (nodesMap.has(fromNodeId) && nodesMap.has(toNodeId)) {
            const edgeId = `handoff-${from}->${to}-${t.id}`;
            edgesMap.set(edgeId, {
              id: edgeId,
              source: fromNodeId,
              target: toNodeId,
              type: 'handoff_to',
              label: `bàn giao #${t.seq}`,
              color: '#D97706',
              dashed: true,
            });
          }
        }
      }
    });
  });

  // 3. Tạo File Nodes
  let fileIdx = 0;
  fileStats.forEach((stats, path) => {
    const fileId = `file-${path}`;
    const totalHits = stats.readCount + stats.editCount * 2;
    const radius = Math.min(36, Math.max(18, 16 + totalHits * 2));

    const angle = (fileIdx / Math.max(1, fileStats.size)) * Math.PI * 2;
    const dist = 320 + (fileIdx % 4) * 35;

    nodesMap.set(fileId, {
      id: fileId,
      type: 'file',
      label: baseFileName(path),
      subLabel: `${stats.readCount} đọc · ${stats.editCount} sửa`,
      color: '#10B981',
      icon: '📄',
      radius,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist + 80,
      vx: 0,
      vy: 0,
      data: {
        filePath: path,
        readCount: stats.readCount,
        editCount: stats.editCount,
      },
    });
    fileIdx++;
  });

  return {
    nodes: Array.from(nodesMap.values()),
    edges: Array.from(edgesMap.values()),
  };
}
