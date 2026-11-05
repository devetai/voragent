import { test, expect } from 'vitest';
import { parseResetTime, truncate, classifyExit, detectBinary } from '../src/common.js';

const now = new Date(2026, 10, 4, 10, 0).getTime();
const at = (h: number, m = 0, day = 4) => new Date(2026, 10, day, h, m).getTime();

test('epoch giây sau dấu |', () => {
  expect(parseResetTime('Claude AI usage limit reached|1762250400', now)).toBe(1762250400000);
});
test('giờ không ngày là lần gặp tiếp theo', () => {
  expect(parseResetTime('resets 3pm', now)).toBe(at(15));
  expect(parseResetTime('resets 3:45 PM', now)).toBe(at(15, 45));
  expect(parseResetTime('try again at 9:30 AM', now)).toBe(at(9, 30, 5));
  expect(parseResetTime('resets 10am', now)).toBe(at(10, 0, 5)); // đúng bằng now thì sang ngày mai
});
test('12am và 12pm', () => {
  expect(parseResetTime('resets 12am', now)).toBe(at(0, 0, 5));
  expect(parseResetTime('resets 12pm', now)).toBe(at(12));
});
test('qua nửa đêm sang tháng sau', () => {
  const end = new Date(2026, 10, 30, 23, 0).getTime();
  expect(parseResetTime('resets 1am', end)).toBe(new Date(2026, 11, 1, 1, 0).getTime());
});
test('thời lượng', () => {
  expect(parseResetTime('in 2 hours', now)).toBe(now + 7_200_000);
  expect(parseResetTime('in 1 hour', now)).toBe(now + 3_600_000);
  expect(parseResetTime('in 45 minutes', now)).toBe(now + 45 * 60_000);
});
test('không đọc được thì null', () => {
  expect(parseResetTime('no time here', now)).toBeNull();
  expect(parseResetTime('resets 13pm', now)).toBeNull();
});
test('truncate giữ phần cuối', () => {
  expect(truncate('abcdef', 4)).toBe('…def');
  expect(truncate('abc', 4)).toBe('abc');
  expect(truncate('abcdef', 4, '..')).toBe('..ef');
});

const P = [/usage limit/i];
const okExit = { code: 0, timedOut: false };

test('classifyExit: nguồn lỗi khớp mẫu là quota_exhausted, đọc giờ reset', () => {
  const r = classifyExit({ errorSources: ['hit your usage limit. Try again at 3:45 PM.'], stderr: '', exit: { code: 1, timedOut: false }, patterns: P, now });
  expect(r).toEqual({ outcome: 'quota_exhausted', resetsAt: at(15, 45), error: 'hit your usage limit. Try again at 3:45 PM.' });
});
test('classifyExit: stderr khớp mẫu cũng là quota_exhausted', () => {
  const r = classifyExit({ errorSources: [], stderr: 'usage limit', exit: { code: 1, timedOut: false }, patterns: P, now });
  expect(r.outcome).toBe('quota_exhausted');
});
test('classifyExit: mã thoát khác 0 không khớp mẫu là error', () => {
  const r = classifyExit({ errorSources: [], stderr: 'boom', exit: { code: 2, timedOut: false }, patterns: P, now });
  expect(r).toEqual({ outcome: 'error', resetsAt: null, error: 'boom' });
  expect(classifyExit({ errorSources: [], stderr: '', exit: { code: 2, timedOut: false }, patterns: P, now }).error).toContain('2');
});
test('classifyExit: mã 0 và không có nguồn lỗi là ok', () => {
  expect(classifyExit({ errorSources: [], stderr: '  ', exit: okExit, patterns: P, now })).toEqual({ outcome: 'ok', resetsAt: null, error: null });
});
test('classifyExit: timedOut là error', () => {
  const r = classifyExit({ errorSources: [], stderr: '', exit: { code: null, timedOut: true }, patterns: P, now });
  expect(r.outcome).toBe('error');
  expect(r.error).toBe('Hết thời gian chờ');
});
test('detectBinary: binary không tồn tại', async () => {
  expect(await detectBinary('khong-ton-tai-xyz')).toEqual({ installed: false, version: null });
});

test('classifyExit: stderr giống quota nhưng lượt thoát mã 0 không lỗi vẫn là ok', () => {
  const r = classifyExit({ errorSources: [], stderr: 'session limit warning', exit: okExit, patterns: [/session limit/i], now });
  expect(r).toEqual({ outcome: 'ok', resetsAt: null, error: null });
});
test('classifyExit: quotaSignal chỉ có hiệu lực khi lượt thất bại', () => {
  const bad = classifyExit({ errorSources: ['x'], hadErrorEvent: true, stderr: '', exit: { code: 1, timedOut: false }, patterns: [], quotaSignal: true, now });
  expect(bad.outcome).toBe('quota_exhausted');
  const fine = classifyExit({ errorSources: [], stderr: '', exit: okExit, patterns: [], quotaSignal: true, now });
  expect(fine.outcome).toBe('ok');
});
