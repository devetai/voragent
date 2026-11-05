import { useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Check, CheckCircle2, ChevronRight, Sparkles, Zap } from 'lucide-react';
import type { ProviderId, ProviderState } from '@voragent/shared';

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
    name: 'Antigravity IDE',
    color: '#2563EB',
    bg: '#EFF6FF',
    border: '#BFDBFE',
  },
};

export function AgentPriorityMultiSelect({
  providers,
  value,
  onChange,
  disabled = false,
}: AgentPriorityMultiSelectProps) {
  // Mode: 'auto' (tự động điều phối toàn bộ) hoặc 'custom' (chọn thứ tự ưu tiên)
  const isAuto = value === null || value.length === 0;

  // Lấy danh sách ID khả dụng
  const allProviderIds = providers.map((p) => p.id);

  // Danh sách đang được sắp xếp ưu tiên
  const currentPriority: ProviderId[] = !isAuto && value ? value : allProviderIds;

  const handleToggleAuto = (auto: boolean) => {
    if (disabled) return;
    if (auto) {
      onChange(null); // null nghĩa là auto handoff toàn bộ
    } else {
      // Chuyển sang custom: khởi tạo danh sách các agent đang cài đặt
      const installed = providers.filter((p) => p.installed).map((p) => p.id);
      onChange(installed.length > 0 ? installed : allProviderIds);
    }
  };

  const handleToggleAgent = (id: ProviderId) => {
    if (disabled || isAuto) return;
    const exists = currentPriority.includes(id);
    let next: ProviderId[];
    if (exists) {
      // Bỏ chọn (nhưng giữ ít nhất 1 agent nếu có thể)
      next = currentPriority.filter((p) => p !== id);
      if (next.length === 0) return; // Không cho bỏ hết
    } else {
      // Thêm vào cuối danh sách ưu tiên
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

  return (
    <div className={`agent-priority-container ${disabled ? 'disabled' : ''}`}>
      {/* Switcher giữa Tự động và Tùy chỉnh */}
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

      {/* Chú thích hướng dẫn */}
      <div className="agent-priority-hint">
        {isAuto ? (
          <span>
            Hệ thống tự động chạy với Agent khả dụng đầu tiên; khi cạn hạn ngạch (quota) sẽ tự động commit và bàn giao sang Agent tiếp theo.
          </span>
        ) : (
          <span>
            Nhấp để chọn/bỏ chọn các Agent, dùng nút mũi tên để xác định Agent nào thực thi trước và Agent nào sẽ tiếp quản khi hết Quota.
          </span>
        )}
      </div>

      {/* Danh sách các Cards Agent */}
      <div className="agent-priority-list">
        {providers.map((p) => {
          const meta = PROVIDER_METAS[p.id] || {
            name: p.id,
            color: 'var(--text-primary)',
            bg: 'var(--bg-subtle)',
            border: 'var(--border-subtle)',
          };

          const isSelected = isAuto ? p.installed : currentPriority.includes(p.id);
          const priorityIndex = currentPriority.indexOf(p.id);
          const hasQuota = p.quota !== null;
          const quotaPercent = hasQuota ? Math.round(p.quota.usedRatio * 100) : 0;

          return (
            <div
              key={p.id}
              className={`agent-priority-card ${isSelected ? 'selected' : 'unselected'} ${!p.installed ? 'not-installed' : ''}`}
              onClick={() => !isAuto && handleToggleAgent(p.id)}
              style={{
                borderColor: isSelected ? meta.border : undefined,
                backgroundColor: isSelected ? meta.bg : undefined,
                cursor: isAuto ? 'default' : 'pointer',
              }}
            >
              <div className="agent-priority-card-left">
                {/* Thứ tự ưu tiên hoặc Checkbox */}
                <div
                  className="agent-priority-rank"
                  style={{
                    backgroundColor: isSelected ? meta.color : 'var(--bg-muted)',
                    color: isSelected ? '#FFFFFF' : 'var(--text-muted)',
                  }}
                >
                  {isAuto ? (
                    <Check size={12} strokeWidth={3} />
                  ) : isSelected ? (
                    <span>{priorityIndex + 1}</span>
                  ) : (
                    <span>-</span>
                  )}
                </div>

                <div className="agent-priority-info">
                  <div className="agent-priority-title-row">
                    <span className="agent-priority-name" style={{ color: isSelected ? meta.color : undefined }}>
                      {meta.name}
                    </span>
                    {p.version && <span className="agent-priority-version">v{p.version}</span>}
                    {!p.installed && (
                      <span className="agent-priority-badge-disabled">Chưa cài đặt</span>
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
                        <span className="agent-quota-text">Sẵn sàng (Không giới hạn)</span>
                      )
                    ) : (
                      <span className="agent-quota-text text-muted">Cần cài CLI để kích hoạt</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Nút điều hướng thứ tự (Move Up / Move Down) trong chế độ tùy chỉnh */}
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
