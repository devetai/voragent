import { ArrowDown, ArrowUp, Check, Sparkles, Zap } from 'lucide-react';
import type { ProviderId, ProviderState } from '@voragent/shared';
import { ProviderIcon } from './ProviderIcon';
import { getProviderUnavailableReason, isProviderAvailable } from '../state';

export interface AgentPriorityMultiSelectProps {
  providers: ProviderState[];
  value: ProviderId[] | null; // null = Tự động hoàn toàn (Auto-handoff)
  onChange: (priorities: ProviderId[] | null) => void;
  disabled?: boolean;
}

const PROVIDER_METAS: Record<string, { name: string; color: string; bg: string; border: string }> = {
  claude: {
    name: 'Claude Code',
    color: '#D97757',
    bg: '#FDF6F3',
    border: '#F6CEBF',
  },
  codex: {
    name: 'Codex CLI',
    color: '#10A37F',
    bg: '#F0FDF4',
    border: '#A7F3D0',
  },
  antigravity: {
    name: 'Antigravity CLI',
    color: '#2563EB',
    bg: '#EFF6FF',
    border: '#BFDBFE',
  },
  opencode: {
    name: 'OpenCode CLI',
    color: '#059669',
    bg: '#ECFDF5',
    border: '#A7F3D0',
  },
};

export function AgentPriorityMultiSelect({
  providers,
  value,
  onChange,
  disabled = false,
}: AgentPriorityMultiSelectProps) {
  const isAuto = value === null || value.length === 0;
  // Chỉ những provider ĐÃ CÀI ĐẶT và KHẢ DỤNG mới được đưa vào danh sách điều phối
  const availableProviders = providers.filter((p) => isProviderAvailable(providers, p.id));
  const installedProviders = providers.filter((p) => p.installed);
  const selectableIds = (availableProviders.length > 0 ? availableProviders : installedProviders).map((p) => p.id);

  const currentPriority: ProviderId[] = !isAuto && value
    ? value.filter((id) => selectableIds.includes(id))
    : selectableIds;

  const handleToggleAuto = (auto: boolean) => {
    if (disabled) return;
    if (auto) {
      onChange(null);
    } else {
      onChange(selectableIds);
    }
  };

  const handleToggleAgent = (id: ProviderId) => {
    if (disabled || isAuto) return;
    if (!selectableIds.includes(id)) return;
    const exists = currentPriority.includes(id);
    let next: ProviderId[];
    if (exists) {
      next = currentPriority.filter((p) => p !== id);
      if (next.length === 0) return;
    } else {
      next = [...currentPriority, id];
    }
    onChange(next);
  };

  const handleMove = (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled || isAuto) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentPriority.length) return;

    const next = [...currentPriority];
    const [moved] = next.splice(index, 1);
    if (moved) {
      next.splice(targetIndex, 0, moved);
      onChange(next);
    }
  };

  // Chỉ hiển thị các Agent đã cài đặt trong danh sách chọn ưu tiên (ẩn hoàn toàn các CLI chưa cài như Codex)
  const visibleProviders = installedProviders.length > 0 ? installedProviders : providers;

  return (
    <div className={`agent-priority-container ${disabled ? 'disabled' : ''}`}>
      <div className="agent-priority-tabs">
        <button
          type="button"
          className={`agent-priority-tab ${isAuto ? 'active' : ''}`}
          onClick={() => handleToggleAuto(true)}
          disabled={disabled}
        >
          <Sparkles size={14} className="agent-priority-tab-icon" />
          <span>Tự động điều phối (Auto-Handoff)</span>
          <span className="agent-priority-badge-recommended">Khuyến nghị</span>
        </button>

        <button
          type="button"
          className={`agent-priority-tab ${!isAuto ? 'active' : ''}`}
          onClick={() => handleToggleAuto(false)}
          disabled={disabled}
        >
          <Zap size={14} className="agent-priority-tab-icon" />
          <span>Tùy chỉnh thứ tự ưu tiên</span>
        </button>
      </div>

      <div className="agent-priority-hint">
        {isAuto ? (
          <span>
            Hệ thống chỉ điều phối các Agent khả dụng đã cài trên máy; khi cạn hạn ngạch (quota) sẽ tự động commit và bàn giao sang Agent khả dụng kế tiếp.
          </span>
        ) : (
          <span>
            Nhấp để chọn/bỏ chọn các Agent khả dụng, dùng nút mũi tên để xác định Agent nào thực thi trước và Agent nào tiếp quản khi hết Quota.
          </span>
        )}
      </div>

      <div className="agent-priority-list">
        {visibleProviders.map((p) => {
          const meta = PROVIDER_METAS[p.id] || {
            name: p.id,
            color: 'var(--text-primary)',
            bg: 'var(--bg-subtle)',
            border: 'var(--border-subtle)',
          };

          const unavailReason = getProviderUnavailableReason(providers, p.id);
          const isSelectable = selectableIds.includes(p.id);
          const isSelected = isSelectable && (isAuto ? true : currentPriority.includes(p.id));
          const priorityIndex = currentPriority.indexOf(p.id);
          const hasQuota = p.usedPercent !== null && p.usedPercent !== undefined;
          const quotaPercent = hasQuota ? Math.round((p.usedPercent ?? 0) * 100) : 0;

          return (
            <div
              key={p.id}
              className={`agent-priority-card ${isSelected ? 'selected' : 'unselected'} ${!isSelectable ? 'not-installed' : ''}`}
              onClick={() => !isAuto && isSelectable && handleToggleAgent(p.id)}
              aria-disabled={!isSelectable ? true : undefined}
              style={{
                borderColor: isSelected ? meta.border : undefined,
                backgroundColor: isSelected ? meta.bg : undefined,
                cursor: isAuto || !isSelectable ? 'not-allowed' : 'pointer',
                pointerEvents: !isSelectable ? 'none' : undefined,
              }}
            >
              <div className="agent-priority-card-left">
                <div
                  className="agent-priority-rank"
                  style={{
                    backgroundColor: isSelected ? meta.color : 'var(--bg-muted)',
                    color: isSelected ? '#FFFFFF' : 'var(--text-muted)',
                  }}
                >
                  {isAuto && isSelectable ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isSelected ? (
                    <span>{priorityIndex + 1}</span>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                <div className="agent-priority-info">
                  <div className="agent-priority-title-row">
                    <ProviderIcon provider={p.id} size={14} />
                    <span className="agent-priority-name" style={{ color: isSelected ? meta.color : undefined }}>
                      {meta.name}
                    </span>
                    {p.version && <span className="agent-priority-version">v{p.version}</span>}
                    {unavailReason && (
                      <span className="agent-priority-badge-disabled">{unavailReason}</span>
                    )}
                  </div>

                  <div className="agent-priority-quota-row">
                    {p.installed ? (
                      hasQuota ? (
                        <div className="agent-quota-indicator">
                          <span className="agent-quota-text">Đã dùng {quotaPercent}%</span>
                          <div className="agent-quota-bar">
                            <div
                              className="agent-quota-bar-fill"
                              style={{
                                width: `${quotaPercent}%`,
                                backgroundColor: quotaPercent > 90 ? 'var(--red-base)' : quotaPercent > 70 ? 'var(--amber-base)' : 'var(--green-base)',
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="agent-quota-text">Sẵn sàng hoạt động</span>
                      )
                    ) : (
                      <span className="agent-quota-text text-muted">Chưa cài đặt CLI</span>
                    )}
                  </div>
                </div>
              </div>

              {!isAuto && isSelected && (
                <div className="agent-priority-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="agent-priority-move-btn"
                    disabled={priorityIndex === 0}
                    onClick={(e) => handleMove(priorityIndex, 'up', e)}
                    title="Tăng mức ưu tiên (chạy trước)"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="agent-priority-move-btn"
                    disabled={priorityIndex === currentPriority.length - 1}
                    onClick={(e) => handleMove(priorityIndex, 'down', e)}
                    title="Giảm mức ưu tiên (chạy sau)"
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
