import { test, expect } from 'vitest';
import { TASK_STATUS_LABEL } from '../src/index.js';

test('mỗi trạng thái task có nhãn tiếng Việt', () => {
  expect(TASK_STATUS_LABEL).toEqual({ queued: 'Chờ', running: 'Đang chạy', waiting_quota: 'Chờ quota',
    awaiting_user: 'Chờ bạn', failed: 'Lỗi', closed: 'Xong' });
});
