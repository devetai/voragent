import { ProviderIcon } from '../components/ProviderIcon';
import type { GraphEdge, GraphNode } from './types';

interface NodeDetailDrawerProps {
  node: GraphNode | null;
  edges: GraphEdge[];
  nodes: GraphNode[];
  onClose: () => void;
  onSelectTask?: (taskId: string) => void;
}

export function NodeDetailDrawer({
  node,
  edges,
  nodes,
  onClose,
  onSelectTask,
}: NodeDetailDrawerProps) {
  if (!node) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const connectedEdges = edges.filter((e) => e.source === node.id || e.target === node.id);

  const neighborNodes = connectedEdges
    .map((e) => {
      const isSource = e.source === node.id;
      const neighborId = isSource ? e.target : e.source;
      return {
        neighbor: nodeMap.get(neighborId),
        edge: e,
        direction: isSource ? 'outgoing' : 'incoming',
      };
    })
    .filter(
      (item): item is { neighbor: GraphNode; edge: GraphEdge; direction: 'outgoing' | 'incoming' } =>
        item.neighbor !== undefined,
    );

  return (
    <aside
      className="node-detail-drawer"
      style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        bottom: '16px',
        width: '360px',
        maxWidth: 'calc(100vw - 32px)',
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        backdropFilter: 'blur(12px)',
        borderRadius: '16px',
        boxShadow: '0 12px 36px rgba(43, 38, 34, 0.16)',
        border: '1px solid #EFE7DA',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        overflow: 'hidden',
        animation: 'slideInRight 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderBottom: '1px solid #F1ECE4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#FAF8F5',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {node.type === 'provider' ? (
            <ProviderIcon provider={node.label} size={24} />
          ) : (
            <span style={{ fontSize: '22px' }}>{node.icon}</span>
          )}
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1E293B' }}>
              {node.label}
            </h3>
            <span style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
              {node.type === 'provider'
                ? 'Agent / Nền tảng AI'
                : node.type === 'task'
                ? 'Nhiệm vụ'
                : node.type === 'file'
                ? 'Tệp mã nguồn'
                : 'Mốc bàn giao'}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="icon-btn-sm"
          onClick={onClose}
          title="Đóng (Esc)"
          aria-label="Đóng"
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {node.type === 'file' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }}>
                Đường dẫn tệp
              </div>
              <div style={{ fontSize: '12px', fontFamily: 'monospace', color: '#0F172A', backgroundColor: '#F8FAFC', padding: '8px 10px', borderRadius: '6px', border: '1px solid #E2E8F0', wordBreak: 'break-all' }}>
                {node.data.filePath ?? node.label}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1, backgroundColor: '#ECFDF5', padding: '10px', borderRadius: '8px', border: '1px solid #A7F3D0' }}>
                <div style={{ fontSize: '11px', color: '#047857' }}>Lượt đọc</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#065F46' }}>{node.data.readCount ?? 0}</div>
              </div>
              <div style={{ flex: 1, backgroundColor: '#FFF7ED', padding: '10px', borderRadius: '8px', border: '1px solid #FED7AA' }}>
                <div style={{ fontSize: '11px', color: '#C2410C' }}>Lượt sửa</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: '#9A3412' }}>{node.data.editCount ?? 0}</div>
              </div>
            </div>
          </div>
        )}

        {node.type === 'task' && node.data.task && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }}>
                Tiêu đề nhiệm vụ
              </div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: '#0F172A', lineHeight: 1.5 }}>
                #{node.data.task.seq} {node.data.task.title}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                Trạng thái: <strong>{node.data.task.status}</strong>
              </div>
              {node.data.task.currentProvider && (
                <div style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', backgroundColor: '#F8FAFC', color: '#334155', border: '1px solid #E2E8F0', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <ProviderIcon provider={node.data.task.currentProvider} size={12} />
                  <strong>{node.data.task.currentProvider}</strong>
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', marginBottom: '4px' }}>
                Thư mục dự án
              </div>
              <div style={{ fontSize: '11px', fontFamily: 'monospace', color: '#475569', wordBreak: 'break-all' }}>
                {node.data.task.repoPath}
              </div>
            </div>

            {onSelectTask && (
              <button
                type="button"
                className="primary"
                onClick={() => onSelectTask(node.data.task!.id)}
                style={{ width: '100%' }}
              >
                Mở chi tiết Task #{node.data.task.seq} ›
              </button>
            )}
          </div>
        )}

        {node.type === 'provider' && node.data.provider && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1, backgroundColor: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '11px', color: '#64748B' }}>Trạng thái</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: node.data.provider.cooldownUntil ? '#D97706' : '#10B981' }}>
                  {node.data.provider.cooldownUntil ? 'Tạm nghỉ (Quota)' : 'Sẵn sàng'}
                </div>
              </div>
              {node.data.provider.usedPercent !== null && (
                <div style={{ flex: 1, backgroundColor: '#F8FAFC', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                  <div style={{ fontSize: '11px', color: '#64748B' }}>Đã dùng</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                    {node.data.provider.usedPercent}%
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: '12px', color: '#64748B', lineHeight: 1.5 }}>
              Cài đặt trên máy: <strong>{node.data.provider.installed ? 'Đã cài đặt' : 'Chưa có'}</strong>
              {node.data.provider.version && ` · Bản ${node.data.provider.version}`}
            </div>
          </div>
        )}

        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '8px' }}>
            Các thực thể liên kết ({neighborNodes.length})
          </div>

          {neighborNodes.length === 0 ? (
            <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>
              Chưa có liên kết trực tiếp nào được ghi nhận.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {neighborNodes.map(({ neighbor, edge }, idx) => (
                <div
                  key={`neighbor-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: '#FAF8F5',
                    border: '1px solid #EFE7DA',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                    {neighbor.type === 'provider' ? (
                      <ProviderIcon provider={neighbor.label} size={14} />
                    ) : (
                      <span>{neighbor.icon}</span>
                    )}
                    <span style={{ fontWeight: 500, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {neighbor.label}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: edge.color,
                      color: '#FFFFFF',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {edge.label ?? edge.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
