import { describe, expect, it } from 'vitest';
import { buildUrl, decodeUriSafely, parseLocation } from '../src/route';

describe('decodeUriSafely', () => {
  it('giải mã URI hợp lệ', () => {
    expect(decodeUriSafely('abc%20def')).toBe('abc def');
    expect(decodeUriSafely('D%3A%2FProjects%2Ftest')).toBe('D:/Projects/test');
  });

  it('trả về null khi chuỗi mã hóa hỏng', () => {
    expect(decodeUriSafely('%')).toBeNull();
    expect(decodeUriSafely('%E0%A4')).toBeNull();
  });
});

describe('parseLocation', () => {
  it('định tuyến trang chủ / danh sách dự án', () => {
    const r1 = parseLocation({ pathname: '/', search: '' });
    expect(r1.view).toBe('projects');
    expect(r1.activeTab).toBe('projects');
    expect(r1.taskId).toBeNull();
    expect(r1.projectPath).toBeNull();

    const r2 = parseLocation({ pathname: '/projects', search: '?key=secret123' });
    expect(r2.view).toBe('projects');
    expect(r2.key).toBe('secret123');
  });

  it('định tuyến bảng task toàn thể và theo dự án qua query', () => {
    const r1 = parseLocation({ pathname: '/board', search: '' });
    expect(r1.view).toBe('board');
    expect(r1.activeTab).toBe('board');
    expect(r1.projectPath).toBeNull();

    const r2 = parseLocation({
      pathname: '/board',
      search: '?project=D%3A%2FWork%2FMyApp&key=secret123',
    });
    expect(r2.view).toBe('board');
    expect(r2.activeTab).toBe('board');
    expect(r2.projectPath).toBe('D:/Work/MyApp');
    expect(r2.key).toBe('secret123');
  });

  it('định tuyến chi tiết task qua pathname /task/:id hoặc /tasks/:id', () => {
    const r1 = parseLocation({ pathname: '/task/task-abc-123', search: '?key=sec' });
    expect(r1.view).toBe('task');
    expect(r1.taskId).toBe('task-abc-123');
    expect(r1.key).toBe('sec');

    const r2 = parseLocation({ pathname: '/tasks/task%20with%20space', search: '' });
    expect(r2.view).toBe('task');
    expect(r2.taskId).toBe('task with space');
  });

  it('định tuyến văn phòng 3D, đồ thị quan hệ và form tạo mới', () => {
    expect(parseLocation({ pathname: '/office', search: '' }).view).toBe('office');
    expect(parseLocation({ pathname: '/office', search: '' }).activeTab).toBe('office');

    expect(parseLocation({ pathname: '/graph', search: '' }).view).toBe('graph');
    expect(parseLocation({ pathname: '/graph', search: '' }).activeTab).toBe('graph');

    expect(parseLocation({ pathname: '/new', search: '?project=D%3A%2FTest' }).view).toBe('new');
    expect(parseLocation({ pathname: '/new', search: '?project=D%3A%2FTest' }).projectPath).toBe('D:/Test');
  });

  it('tương thích ngược và nhận diện legacy hash', () => {
    const r1 = parseLocation({ pathname: '/', search: '', hash: '#/task/legacy-id' });
    expect(r1.view).toBe('task');
    expect(r1.taskId).toBe('legacy-id');

    const r2 = parseLocation({ pathname: '/', search: '', hash: '#/project/D%3A%2FLegacy' });
    expect(r2.view).toBe('board');
    expect(r2.projectPath).toBe('D:/Legacy');

    const r3 = parseLocation({ pathname: '/', search: '', hash: '#/office' });
    expect(r3.view).toBe('office');
  });
});

describe('buildUrl', () => {
  it('tự động bảo lưu param key từ URL hiện tại', () => {
    const currentSearch = '?key=my-token-123';
    expect(buildUrl('/board', currentSearch)).toBe('/board?key=my-token-123');
    expect(buildUrl('/task/task-1', currentSearch)).toBe('/task/task-1?key=my-token-123');
    expect(buildUrl('/board?project=foo', currentSearch)).toBe('/board?project=foo&key=my-token-123');
  });

  it('xây dựng URL từ object với view và query params', () => {
    const currentSearch = '?key=token';
    const u1 = buildUrl({ view: 'board', projectPath: 'd:/work' }, currentSearch);
    expect(u1).toBe('/board?project=d%3A%2Fwork&key=token');

    const u2 = buildUrl({ view: 'task', taskId: 'task-100' }, currentSearch);
    expect(u2).toBe('/task/task-100?key=token');

    const u3 = buildUrl({ view: 'projects' }, currentSearch);
    expect(u3).toBe('/?key=token');
  });

  it('chuẩn hóa target dạng legacy hash', () => {
    expect(buildUrl('#/board', '')).toBe('/board');
    expect(buildUrl('#/office', '?key=k1')).toBe('/office?key=k1');
    expect(buildUrl('#/task/t1', '?key=k1')).toBe('/task/t1?key=k1');
  });
});
