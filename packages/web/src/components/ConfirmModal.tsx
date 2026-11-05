import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'danger' | 'warning' | 'primary';
  icon?: 'trash' | 'warning' | 'none';
  isLoading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy bỏ',
  confirmVariant = 'danger',
  icon = 'trash',
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Focus nút Hủy khi mở modal và lắng nghe phím Escape
  useEffect(() => {
    if (!isOpen) return;

    // Tự động focus nút Hủy để tránh bấm nhầm Enter xác nhận thao tác nguy hiểm
    const timer = setTimeout(() => {
      cancelBtnRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        e.stopPropagation();
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isLoading, onCancel]);

  if (!isOpen) return null;

  const isDanger = confirmVariant === 'danger';
  const isWarning = confirmVariant === 'warning';

  return createPortal(
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(26, 22, 19, 0.45)',
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.15s ease-out',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) onCancel();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className="confirm-modal-card"
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          border: '1px solid #E8E2D8',
          boxShadow: '0 20px 25px -5px rgba(43, 38, 34, 0.15), 0 8px 10px -6px rgba(43, 38, 34, 0.1)',
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          {icon !== 'none' && (
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                backgroundColor: isDanger ? '#FEF2F2' : isWarning ? '#FFFBEB' : '#F5F3FF',
                color: isDanger ? '#EF4444' : isWarning ? '#D97706' : '#7C3AED',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                border: isDanger ? '1px solid #FEE2E2' : isWarning ? '1px solid #FEF3C7' : '1px solid #EDE9FE',
              }}
            >
              {icon === 'trash' ? <Trash2 size={18} /> : <AlertTriangle size={18} />}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <h3
              id="confirm-modal-title"
              style={{
                margin: 0,
                fontSize: '15.5px',
                fontWeight: 700,
                color: '#1F1B18',
                letterSpacing: '-0.2px',
              }}
            >
              {title}
            </h3>
            <div
              style={{
                marginTop: '6px',
                fontSize: '13px',
                lineHeight: '1.5',
                color: '#6B6258',
              }}
            >
              {message}
            </div>
          </div>

          <button
            type="button"
            className="icon-btn-sm"
            onClick={onCancel}
            disabled={isLoading}
            aria-label="Đóng"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#9E9487',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px',
            marginTop: '6px',
            paddingTop: '12px',
            borderTop: '1px solid #F3EDE2',
          }}
        >
          <button
            ref={cancelBtnRef}
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            style={{
              padding: '0 14px',
              height: '34px',
              minHeight: '34px',
              fontSize: '13px',
              fontWeight: 500,
              borderRadius: '8px',
              border: '1px solid #E8E2D8',
              backgroundColor: '#FFFFFF',
              color: '#4A433B',
              cursor: 'pointer',
            }}
          >
            {cancelText}
          </button>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => void onConfirm()}
            style={{
              padding: '0 16px',
              height: '34px',
              minHeight: '34px',
              fontSize: '13px',
              fontWeight: 600,
              borderRadius: '8px',
              border: isDanger ? '1px solid #DC2626' : isWarning ? '1px solid #D97706' : '1px solid #1F1B18',
              backgroundColor: isDanger ? '#EF4444' : isWarning ? '#F59E0B' : '#1F1B18',
              color: '#FFFFFF',
              cursor: isLoading ? 'wait' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isDanger
                ? '0 2px 4px rgba(239, 68, 68, 0.25)'
                : '0 2px 4px rgba(0, 0, 0, 0.08)',
            }}
          >
            {isLoading ? 'Đang xử lý...' : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
