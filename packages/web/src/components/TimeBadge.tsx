import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

/**
 * Định dạng thời gian tương đối theo phong cách tự nhiên bằng tiếng Việt.
 */
export function formatRelativeTime(ms: number | null, now: number = Date.now()): string {
  if (ms === null || isNaN(ms) || ms <= 0) return 'Chưa rõ';
  const diffSec = Math.floor((now - ms) / 1000);
  if (diffSec < 0 || diffSec < 60) return 'Vừa xong';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `Hôm qua ${hh}:${mm}`;
  }
  if (diffDays < 7) return `${diffDays} ngày trước`;

  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/**
 * Định dạng ngày giờ đầy đủ chuẩn xác (dùng cho tooltip hoặc chi tiết).
 */
export function formatFullDateTime(ms: number | null): string {
  if (ms === null || isNaN(ms) || ms <= 0) return 'Không có thông tin thời gian';
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${min}:${ss} • ${dd}/${mm}/${yyyy}`;
}

export function TimeBadge({
  timestamp,
  showIcon = true,
  className = '',
  highlightRecent = true,
}: {
  timestamp: number | null;
  showIcon?: boolean;
  className?: string;
  highlightRecent?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Tự động cập nhật relative time mỗi 30 giây
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const relative = formatRelativeTime(timestamp, now);
  const full = formatFullDateTime(timestamp);
  // Đánh dấu tác vụ cập nhật trong vòng 15 phút
  const isRecent = highlightRecent && timestamp !== null && (now - timestamp) < 15 * 60 * 1000;

  return (
    <span
      className={`time-badge ${isRecent ? 'recent' : ''} ${className}`}
      data-tooltip={full}
    >
      {showIcon && <Clock size={11} className="time-badge-icon" />}
      <span className="time-badge-text">{relative}</span>
      {isRecent && <span className="time-badge-dot" data-tooltip="Hoạt động trong 15 phút qua" />}
    </span>
  );
}
