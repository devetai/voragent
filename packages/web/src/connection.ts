/** Trạng thái kết nối WebSocket và quyết định thử lại. Thuần, không phụ thuộc trình duyệt. */
export type ConnectionStatus = 'connected' | 'reconnecting' | 'auth-failed' | 'daemon-down';

export interface ConnectionState {
  status: ConnectionStatus;
  /** Số lần kết nối thất bại liên tiếp (chưa có onopen). */
  failures: number;
  /** Chờ bao lâu trước lần kết nối kế tiếp. */
  retryMs: number;
  /** true: cần dò bằng một GET có xác thực (vd. /api/providers) để biết 401 hay daemon chết. */
  probe: boolean;
}

/** open: WebSocket mở được; closed: đóng/thất bại; probe-*: kết quả dò. */
export type ConnectionEvent = 'open' | 'closed' | 'probe-401' | 'probe-error' | 'probe-ok';

export const FAST_RETRY_MS = 2_000;
/** Khóa sai thì thử nhanh cũng vô ích: thử rất thưa. */
export const SLOW_RETRY_MS = 30_000;
/** Sau chừng này lần thất bại liên tiếp thì dò. */
export const PROBE_AFTER = 3;

export const INITIAL_CONNECTION: ConnectionState = {
  status: 'reconnecting', failures: 0, retryMs: FAST_RETRY_MS, probe: false,
};

export function nextConnectionState(s: ConnectionState, e: ConnectionEvent): ConnectionState {
  switch (e) {
    case 'open':
      return { status: 'connected', failures: 0, retryMs: FAST_RETRY_MS, probe: false };
    case 'closed': {
      const failures = s.failures + 1;
      const status = s.status === 'connected' ? 'reconnecting' : s.status;
      // auth-failed giữ nhịp chậm; mỗi lần đóng dò lại để biết khóa đã đúng lại hay daemon chết hẳn.
      const retryMs = status === 'auth-failed' ? SLOW_RETRY_MS : FAST_RETRY_MS;
      return { status, failures, retryMs, probe: failures >= PROBE_AFTER };
    }
    case 'probe-401':
      return { ...s, status: 'auth-failed', retryMs: SLOW_RETRY_MS, probe: false };
    case 'probe-error':
      return { ...s, status: 'daemon-down', retryMs: FAST_RETRY_MS, probe: false };
    case 'probe-ok':
      return { status: 'reconnecting', failures: 0, retryMs: FAST_RETRY_MS, probe: false };
  }
}
