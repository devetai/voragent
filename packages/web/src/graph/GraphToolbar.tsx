import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus, SlidersHorizontal, Zap } from 'lucide-react';
import { ProviderIcon } from '../components/ProviderIcon';
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
  const [filterOpen, setFilterOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [filterOpen]);

  const toggleFilter = (key: keyof Omit<GraphFilterState, 'searchQuery'>) => {
    onFilterChange({
      ...filter,
      [key]: !filter[key],
    });
  };

  const activeFilterCount = [
    filter.showProviders,
    filter.showTasks,
    filter.showFiles,
    filter.showHandoffs,
  ].filter(Boolean).length;

  return (
    <div
      className="graph-toolbar"
      style={{
        position: 'absolute',
        top: '12px',
        left: '12px',
        right: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {/* Cụm Tìm kiếm + Nút Popover Bộ lọc gọn gàng */}
      <div
        ref={popRef}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(8px)',
          padding: '5px 8px',
          borderRadius: '10px',
          boxShadow: 'var(--shadow-sm)',
          border: '1px solid var(--border-subtle)',
          pointerEvents: 'auto',
        }}
      >
        <input
          type="text"
          placeholder="Tìm node, file hoặc task…"
          value={filter.searchQuery}
          onChange={(e) => onFilterChange({ ...filter, searchQuery: e.target.value })}
          style={{
            fontSize: '12px',
            height: '28px',
            padding: '0 8px',
            borderRadius: '6px',
            border: '1px solid var(--border-subtle)',
            width: '180px',
          }}
        />

        <button
          type="button"
          className="office-mini-btn"
          onClick={() => setFilterOpen((v) => !v)}
          data-tooltip="Bật/tắt các loại thực thể hiển thị trên đồ thị"
          data-tooltip-placement="bottom"
          style={{
            height: '28px',
            minHeight: '28px',
            background: filterOpen || activeFilterCount < 4 ? '#FFFBEB' : 'var(--bg-surface)',
            borderColor: filterOpen || activeFilterCount < 4 ? '#F59E0B' : 'var(--border-subtle)',
          }}
        >
          <SlidersHorizontal size={12} />
          <span>{activeFilterCount}/4</span>
        </button>

        <span className="muted" style={{ fontSize: '11.5px', padding: '0 4px' }}>
          {nodeCount} nút · {edgeCount} cạnh
        </span>

        {filterOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              width: '235px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '10px 12px',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              zIndex: 30,
            }}
          >
            <div style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '2px' }}>
              Hiển thị thực thể trên đồ thị
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filter.showProviders}
                onChange={() => toggleFilter('showProviders')}
              />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <ProviderIcon provider="claude" size={13} />
                <ProviderIcon provider="antigravity" size={13} />
                <span>Agent / Nền tảng</span>
              </span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filter.showTasks}
                onChange={() => toggleFilter('showTasks')}
              />
              <span>📋 Task công việc</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filter.showFiles}
                onChange={() => toggleFilter('showFiles')}
              />
              <span>📄 Tệp mã nguồn</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filter.showHandoffs}
                onChange={() => toggleFilter('showHandoffs')}
              />
              <span>🔄 Mốc bàn giao</span>
            </label>
          </div>
        )}
      </div>

      {/* Cụm công cụ Zoom & Căn toàn cảnh: Icon-only + Tooltip (Rule 12) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(8px)',
          padding: '4px 6px',
          borderRadius: '10px',
          boxShadow: 'var(--shadow-sm)',
          border: '1px solid var(--border-subtle)',
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          className="icon-btn-sm"
          onClick={onZoomIn}
          data-tooltip="Phóng to đồ thị (+)"
          data-tooltip-placement="bottom"
          aria-label="Phóng to"
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="icon-btn-sm"
          onClick={onZoomOut}
          data-tooltip="Thu nhỏ đồ thị (-)"
          data-tooltip-placement="bottom"
          aria-label="Thu nhỏ"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="icon-btn-sm"
          onClick={onFitView}
          data-tooltip="Căn toàn cảnh vừa khít màn hình"
          data-tooltip-placement="bottom"
          aria-label="Căn toàn cảnh"
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className="icon-btn-sm"
          onClick={onTogglePhysics}
          data-tooltip={isPhysicsActive ? 'Đang bật lực cân bằng vật lý (Bấm để tạm dừng)' : 'Đang tạm dừng lực vật lý (Bấm để bật)'}
          data-tooltip-placement="bottom"
          aria-label="Bật/Tắt lực vật lý"
          style={{
            background: isPhysicsActive ? 'var(--blue-bg)' : 'var(--bg-surface)',
            color: isPhysicsActive ? 'var(--blue-text)' : 'var(--text-secondary)',
            borderColor: isPhysicsActive ? 'var(--blue-border)' : 'var(--border-subtle)',
          }}
        >
          <Zap size={13} />
        </button>
      </div>
    </div>
  );
}
