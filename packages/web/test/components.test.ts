import { describe, expect, it } from 'vitest';
import { formatFullDateTime, formatRelativeTime } from '../src/components/TimeBadge';

describe('formatRelativeTime', () => {
  const baseNow = 1700000000000; // Mock current timestamp

  it('xử lý timestamp null hoặc không hợp lệ', () => {
    expect(formatRelativeTime(null, baseNow)).toBe('Chưa rõ');
    expect(formatRelativeTime(NaN, baseNow)).toBe('Chưa rõ');
    expect(formatRelativeTime(-100, baseNow)).toBe('Chưa rõ');
  });

  it('định dạng thời gian vừa xong (< 60s)', () => {
    expect(formatRelativeTime(baseNow - 10_000, baseNow)).toBe('Vừa xong');
    expect(formatRelativeTime(baseNow - 55_000, baseNow)).toBe('Vừa xong');
  });

  it('định dạng số phút trước', () => {
    expect(formatRelativeTime(baseNow - 5 * 60 * 1000, baseNow)).toBe('5 phút trước');
    expect(formatRelativeTime(baseNow - 45 * 60 * 1000, baseNow)).toBe('45 phút trước');
  });

  it('định dạng số giờ trước', () => {
    expect(formatRelativeTime(baseNow - 2 * 3600 * 1000, baseNow)).toBe('2 giờ trước');
    expect(formatRelativeTime(baseNow - 23 * 3600 * 1000, baseNow)).toBe('23 giờ trước');
  });

  it('định dạng hôm qua', () => {
    const yesterday = baseNow - 25 * 3600 * 1000;
    const res = formatRelativeTime(yesterday, baseNow);
    expect(res).toMatch(/^Hôm qua \d{2}:\d{2}$/);
  });

  it('định dạng ngày trước trong tuần', () => {
    expect(formatRelativeTime(baseNow - 3 * 86400 * 1000, baseNow)).toBe('3 ngày trước');
    expect(formatRelativeTime(baseNow - 5 * 86400 * 1000, baseNow)).toBe('5 ngày trước');
  });

  it('định dạng ngày tháng đầy đủ cho thời gian xa (> 7 ngày)', () => {
    const oldTime = baseNow - 10 * 86400 * 1000;
    const res = formatRelativeTime(oldTime, baseNow);
    expect(res).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });
});

describe('formatFullDateTime', () => {
  it('xử lý giá trị rỗng', () => {
    expect(formatFullDateTime(null)).toBe('Không có thông tin thời gian');
  });

  it('định dạng đầy đủ giờ phút giây và ngày tháng', () => {
    const ts = new Date(2026, 10, 5, 14, 30, 45).getTime();
    const res = formatFullDateTime(ts);
    expect(res).toBe('14:30:45 • 05/11/2026');
  });
});
