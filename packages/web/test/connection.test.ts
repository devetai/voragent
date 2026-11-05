import { describe, expect, it } from 'vitest';
import { FAST_RETRY_MS, INITIAL_CONNECTION, PROBE_AFTER, SLOW_RETRY_MS, nextConnectionState } from '../src/connection';
import type { ConnectionEvent, ConnectionState } from '../src/connection';

const run = (evs: ConnectionEvent[], from: ConnectionState = INITIAL_CONNECTION): ConnectionState =>
  evs.reduce(nextConnectionState, from);

describe('nextConnectionState', () => {
  it('2 lần đóng liên tiếp vẫn reconnecting, chưa dò', () => {
    const s = run(['closed', 'closed']);
    expect(PROBE_AFTER).toBe(3);
    expect(s).toMatchObject({ status: 'reconnecting', failures: 2, retryMs: FAST_RETRY_MS, probe: false });
  });

  it('lần thất bại thứ 3 yêu cầu dò', () => {
    expect(run(['closed', 'closed', 'closed'])).toMatchObject({ failures: 3, probe: true, retryMs: FAST_RETRY_MS });
  });

  it('probe-401: auth-failed, thử lại chậm, không dò nữa', () => {
    const s = run(['closed', 'closed', 'closed', 'probe-401']);
    expect(s).toMatchObject({ status: 'auth-failed', retryMs: SLOW_RETRY_MS, probe: false });
  });

  it('auth-failed: lần đóng tiếp theo dò lại nhưng vẫn giữ nhịp chậm', () => {
    const s = run(['closed', 'closed', 'closed', 'probe-401', 'closed']);
    expect(s).toMatchObject({ status: 'auth-failed', retryMs: SLOW_RETRY_MS, probe: true });
  });

  it('probe-error: daemon-down, thử lại mỗi 2 giây', () => {
    const s = run(['closed', 'closed', 'closed', 'probe-error']);
    expect(s).toMatchObject({ status: 'daemon-down', retryMs: FAST_RETRY_MS, probe: false });
  });

  it('probe-ok: vẫn reconnecting, nhịp nhanh, đếm lại từ 0', () => {
    const s = run(['closed', 'closed', 'closed', 'probe-ok']);
    expect(s).toMatchObject({ status: 'reconnecting', failures: 0, retryMs: FAST_RETRY_MS, probe: false });
  });

  it('open đặt lại mọi thứ, kể cả từ auth-failed', () => {
    const s = run(['closed', 'closed', 'closed', 'probe-401', 'open']);
    expect(s).toEqual({ status: 'connected', failures: 0, retryMs: FAST_RETRY_MS, probe: false });
  });

  it('thuần: không sửa state đầu vào', () => {
    const before = { ...INITIAL_CONNECTION };
    nextConnectionState(INITIAL_CONNECTION, 'closed');
    expect(INITIAL_CONNECTION).toEqual(before);
  });
});
