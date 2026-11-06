import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Key, RefreshCw, Terminal, WifiOff } from 'lucide-react';
import type { ConnectionState } from '../connection';

export interface ConnectionOverlayProps {
  conn: ConnectionState;
  onRetry?: () => void;
}

export function ConnectionOverlay({ conn, onRetry }: ConnectionOverlayProps) {
  const [customKey, setCustomKey] = useState('');
  const [retrying, setRetrying] = useState(false);

  // Chỉ hiển thị lớp phủ khi mất kết nối thực sự:
  // - auth-failed: Khóa 401
  // - daemon-down: Cổng 4717 không phản hồi
  // - reconnecting và đã thất bại ít nhất 2 lần liên tiếp
  const shouldShow =
    conn.status === 'auth-failed' ||
    conn.status === 'daemon-down' ||
    (conn.status === 'reconnecting' && conn.failures >= 2);

  // Khóa cuộn trang toàn diện khi lớp phủ hiển thị (Zero background scroll)
  useEffect(() => {
    if (!shouldShow || typeof document === 'undefined') return;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [shouldShow]);

  if (!shouldShow) {
    return null;
  }

  const isAuthFailed = conn.status === 'auth-failed';

  const handleManualRetry = () => {
    setRetrying(true);
    onRetry?.();
    setTimeout(() => setRetrying(false), 1200);
  };

  const handleApplyKey = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customKey.trim();
    if (!trimmed) return;

    try {
      // Nếu người dùng dán toàn bộ URL: http://127.0.0.1:4717/?key=...
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const url = new URL(trimmed);
        const k = url.searchParams.get('key');
        if (k) {
          window.location.href = url.toString();
          return;
        }
      }
      // Nếu dán key thuần
      const url = new URL(window.location.href);
      url.searchParams.set('key', trimmed);
      window.location.href = url.toString();
    } catch {
      window.location.reload();
    }
  };

  const content = (
    <div
      className="connection-overlay-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conn-overlay-title"
    >
      <div className="connection-overlay-card">
        {/* ========================================================
            HOẠT HỌA CHÚ RẮN VORAGENT DỄ THƯƠNG ĐỨT DÂY KẾT NỐI
           ======================================================== */}
        <div className="connection-snake-stage" aria-hidden="true">
          <svg
            viewBox="0 0 240 130"
            className="connection-snake-svg"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Vòng hào quang tín hiệu nhấp nháy phát ra từ điểm nối */}
            <circle cx="120" cy="85" r="28" className="conn-sparkle-ring ring-1" />
            <circle cx="120" cy="85" r="42" className="conn-sparkle-ring ring-2" />

            {/* Sợi dây cắm điện bên trái (gắn vào Rắn) */}
            <path
              d="M 28 85 Q 60 85 88 85"
              stroke="#D1C7B7"
              strokeWidth="4"
              strokeLinecap="round"
              className="conn-cable-left"
            />
            {/* Phích cắm bên trái */}
            <g className="conn-plug-left">
              <rect x="88" y="77" width="16" height="16" rx="4" fill="#5C5248" />
              <rect x="104" y="80" width="7" height="3" rx="1" fill="#D97706" />
              <rect x="104" y="87" width="7" height="3" rx="1" fill="#D97706" />
            </g>

            {/* Tia lửa điện / Tín hiệu từ trường gián đoạn giữa 2 đầu cắm */}
            <g className="conn-sparks">
              <path
                d="M 115 81 L 118 85 L 114 86 L 122 91 L 118 86 L 123 85 Z"
                fill="#F59E0B"
                className="conn-spark-bolt"
              />
              <circle cx="119" cy="76" r="2" fill="#FBBF24" className="conn-spark-dot d1" />
              <circle cx="123" cy="94" r="1.5" fill="#FBBF24" className="conn-spark-dot d2" />
            </g>

            {/* Ổ cắm bên phải */}
            <g className="conn-socket-right">
              <rect x="130" y="76" width="18" height="18" rx="4" fill="#5C5248" />
              <circle cx="135" cy="81.5" r="1.5" fill="#1F1B18" />
              <circle cx="135" cy="88.5" r="1.5" fill="#1F1B18" />
            </g>
            {/* Sợi dây điện bên phải dẫn về máy chủ */}
            <path
              d="M 148 85 Q 180 85 212 85"
              stroke="#D1C7B7"
              strokeWidth="4"
              strokeLinecap="round"
              className="conn-cable-right"
            />

            {/* CHÚ RẮN VORAGENT DỄ THƯƠNG NGỒI PHÍA TRÊN DÂY CẮM */}
            <g className="conn-snake-character">
              {/* Đuôi rắn vẫy nhẹ */}
              <path
                d="M 45 68 Q 30 65 24 54 Q 20 44 28 38"
                stroke="#059669"
                strokeWidth="7"
                strokeLinecap="round"
                fill="none"
                className="conn-snake-tail"
              />

              {/* Thân rắn uốn lượn đáng yêu (Màu xanh ngọc Voragent) */}
              <path
                d="M 38 68 C 45 74 65 74 75 66 C 85 58 100 58 110 66"
                stroke="#059669"
                strokeWidth="9"
                strokeLinecap="round"
                fill="none"
                className="conn-snake-body"
              />

              {/* Vằn bụng màu kem sáng */}
              <path
                d="M 48 70 Q 56 73 64 69"
                stroke="#A7F3D0"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />
              <path
                d="M 85 64 Q 93 63 100 66"
                stroke="#A7F3D0"
                strokeWidth="3.5"
                strokeLinecap="round"
                fill="none"
              />

              {/* Đầu rắn tròn trịa */}
              <g className="conn-snake-head">
                <circle cx="118" cy="46" r="16" fill="#059669" />

                {/* Má hồng hào dễ thương */}
                <circle cx="109" cy="52" r="3.2" fill="#F472B6" opacity="0.65" />
                <circle cx="127" cy="52" r="3.2" fill="#F472B6" opacity="0.65" />

                {/* Đôi mắt tròn ngơ ngác chớp chớp */}
                <g className="conn-snake-eyes">
                  <ellipse cx="113" cy="44" rx="2.8" ry="3.8" fill="#1F1B18" className="conn-eye" />
                  <ellipse cx="123" cy="44" rx="2.8" ry="3.8" fill="#1F1B18" className="conn-eye" />
                  {/* Đốm sáng trong mắt */}
                  <circle cx="114" cy="43" r="1.1" fill="#FFFFFF" />
                  <circle cx="124" cy="43" r="1.1" fill="#FFFFFF" />
                </g>

                {/* Miệng nhỏ bối rối */}
                <path
                  d="M 115 52 Q 118 55 121 52"
                  stroke="#1F1B18"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />

                {/* Dấu hỏi chấm ngộ nghĩnh bay trên đầu */}
                <g className="conn-floating-question">
                  <text
                    x="132"
                    y="32"
                    fill="#D97706"
                    fontSize="16"
                    fontWeight="bold"
                    fontFamily="monospace"
                  >
                    ?
                  </text>
                </g>
              </g>
            </g>
          </svg>
        </div>

        {/* ========================================================
            TIÊU ĐỀ & THÔNG ĐIỆP RÕ RÀNG THEO TỪNG TÌNH HUỐNG
           ======================================================== */}
        <div className="connection-overlay-content">
          <div className="connection-badge-wrap">
            {isAuthFailed ? (
              <span className="connection-status-chip is-auth">
                <Key size={12} />
                <span>Phiên làm việc đã đổi khóa</span>
              </span>
            ) : (
              <span className="connection-status-chip is-down">
                <WifiOff size={12} />
                <span>Mất kết nối với Voragent</span>
              </span>
            )}
          </div>

          <h2 id="conn-overlay-title" className="connection-overlay-title">
            {isAuthFailed ? 'Khóa truy cập đã thay đổi' : 'Đang tìm lại kết nối…'}
          </h2>

          <p className="connection-overlay-desc">
            {isAuthFailed ? (
              <>
                Tiến trình daemon <strong>voragent</strong> có thể vừa được khởi động lại trong terminal
                với một khóa xác thực bảo mật mới. Hãy mở lại đường dẫn URL được in ra hoặc cập nhật khóa bên dưới.
              </>
            ) : (
              <>
                Không thể giữ liên lạc với máy chủ <strong>voragent</strong> tại <code>127.0.0.1:4717</code>.
                Hệ thống đang tự động kết nối lại {conn.failures > 0 ? `(lần thử ${conn.failures})` : ''}…
              </>
            )}
          </p>

          {/* Ô nhập khóa dành riêng cho trường hợp auth-failed */}
          {isAuthFailed && (
            <form onSubmit={handleApplyKey} className="connection-key-form">
              <div className="connection-input-group">
                <input
                  type="text"
                  className="connection-key-input"
                  placeholder="Dán toàn bộ URL mới hoặc mã khóa ?key=..."
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="primary connection-submit-btn" disabled={!customKey.trim()}>
                  Áp dụng khóa
                </button>
              </div>
            </form>
          )}

          {/* HÀNG NÚT THAO TÁC CHÍNH */}
          <div className="connection-actions-row">
            <button
              type="button"
              className="primary connection-action-btn"
              onClick={handleManualRetry}
              disabled={retrying}
            >
              <RefreshCw size={14} className={retrying ? 'spin' : ''} />
              <span>{retrying ? 'Đang thử lại…' : 'Thử kết nối lại ngay'}</span>
            </button>

            <button
              type="button"
              className="connection-secondary-btn"
              onClick={() => window.location.reload()}
            >
              <span>Tải lại trang (F5)</span>
            </button>
          </div>

          {/* GỢI Ý DÒNG LỆNH HỮU ÍCH */}
          <div className="connection-terminal-tip">
            <Terminal size={13} className="tip-icon" />
            <div className="tip-text">
              <span>Đảm bảo lệnh terminal vẫn đang hoạt động:</span>
              <code>voragent</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
}
