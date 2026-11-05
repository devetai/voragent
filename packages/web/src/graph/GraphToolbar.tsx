import type { GraphFilterState } from './types';

interface GraphToolbarProps {
  filter: GraphFilterState;
  onFilterChange: (next: GraphFilterState) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onTogglePhysics: () => void;
  isPhysicsActive: boolean;
  nodeCount: number;
  edgeCount: number;
}

export function GraphToolbar({
  filter,
  onFilterChange,
  onZoomIn,
  onZoomOut,
  onFitView,
  onTogglePhysics,
  isPhysicsActive,
  nodeCount,
  edgeCount,
}: GraphToolbarProps) {
  const toggleFilter = (key: keyof Omit<GraphFilterState, 'searchQuery'>) => {
    onFilterChange({
      ...filter,
      [key]: !filter[key],
    });
  };

  return (
    <div className="graph-toolbar" style={{
      position: 'absolute',
      top: '16px',
      left: '16px',
      right: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      {/* Cụm bộ lọc danh mục & Tìm kiếm (Filter chips) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        padding: '6px 12px',
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        border: '1px solid #EFE7DA',
        pointerEvents: 'auto',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748B' }}>Lọc:</span>

          <button
            type="button"
            onClick={() => toggleFilter('showProviders')}
            style={{
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: filter.showProviders ? '1px solid #D97757' : '1px solid #E2E8F0',
              backgroundColor: filter.showProviders ? '#FFF7ED' : '#F8FAFC',
              color: filter.showProviders ? '#C2410C' : '#94A3B8',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            🐍 Agent
          </button>

          <button
            type="button"
            onClick={() => toggleFilter('showTasks')}
            style={{
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: filter.showTasks ? '1px solid #2563EB' : '1px solid #E2E8F0',
              backgroundColor: filter.showTasks ? '#EFF6FF' : '#F8FAFC',
              color: filter.showTasks ? '#1D4ED8' : '#94A3B8',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            📋 Task
          </button>

          <button
            type="button"
            onClick={() => toggleFilter('showFiles')}
            style={{
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: filter.showFiles ? '1px solid #10B981' : '1px solid #E2E8F0',
              backgroundColor: filter.showFiles ? '#ECFDF5' : '#F8FAFC',
              color: filter.showFiles ? '#047857' : '#94A3B8',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            📄 File
          </button>

          <button
            type="button"
            onClick={() => toggleFilter('showHandoffs')}
            style={{
              fontSize: '12px',
              padding: '4px 8px',
              borderRadius: '6px',
              border: filter.showHandoffs ? '1px solid #F59E0B' : '1px solid #E2E8F0',
              backgroundColor: filter.showHandoffs ? '#FEF3C7' : '#F8FAFC',
              color: filter.showHandoffs ? '#B45309' : '#94A3B8',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            🔄 Bàn giao
          </button>
        </div>

        {/* Ô tìm kiếm nhanh */}
        <input
          type="text"
          placeholder="Tìm file hoặc task…"
          value={filter.searchQuery}
          onChange={(e) => onFilterChange({ ...filter, searchQuery: e.target.value })}
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            borderRadius: '6px',
            border: '1px solid #CBD5E1',
            outline: 'none',
            width: '150px',
          }}
        />

        {/* Đếm số phần tử */}
        <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: '4px' }}>
          {nodeCount} nút · {edgeCount} liên kết
        </span>
      </div>

      {/* Cụm công cụ Zoom & Căn toàn cảnh */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        padding: '4px 8px',
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        border: '1px solid #EFE7DA',
        pointerEvents: 'auto',
      }}>
        <button
          type="button"
          onClick={onZoomIn}
          title="Phóng to"
          style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', cursor: 'pointer', fontWeight: 600 }}
        >
          +
        </button>
        <button
          type="button"
          onClick={onZoomOut}
          title="Thu nhỏ"
          style={{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', cursor: 'pointer', fontWeight: 600 }}
        >
          -
        </button>
        <button
          type="button"
          onClick={onFitView}
          title="Căn toàn cảnh"
          style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', cursor: 'pointer' }}
        >
          Toàn cảnh
        </button>
        <button
          type="button"
          onClick={onTogglePhysics}
          title="Bật/Tắt tính toán lực cân bằng"
          style={{
            fontSize: '11px',
            padding: '4px 8px',
            borderRadius: '6px',
            border: isPhysicsActive ? '1px solid #3B82F6' : '1px solid #E2E8F0',
            backgroundColor: isPhysicsActive ? '#EFF6FF' : '#FFFFFF',
            color: isPhysicsActive ? '#1D4ED8' : '#475569',
            cursor: 'pointer',
          }}
        >
          {isPhysicsActive ? '⚡ Đang cân bằng' : '⏸ Tạm dừng lực'}
        </button>
      </div>
    </div>
  );
}
