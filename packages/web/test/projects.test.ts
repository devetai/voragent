import { describe, expect, it } from 'vitest';
import type { Project, Task } from '@voragent/shared';
import { OTHER, describeProjectSources, effectiveChoice, filterProjects, formatLastUsed, projectKeyOf, resolveProjectRoute, sortProjects, taskIdOf, tasksOfProject } from '../src/state';

const task = (id: string, repoPath: string): Task => ({
  id, seq: 1, title: 't', repoPath, workspacePath: null, branch: null, baseCommit: null,
  mode: 'head-dirty-commit', priority: null, status: 'queued', currentProvider: null, createdAt: 0, updatedAt: 0,
});

const project = (name: string, lastUsedAt: number | null, extra: Partial<Project> = {}): Project => ({
  id: name, path: `/p/${name}`, name, lastUsedAt, sources: [], isGit: true, branch: null, dirtyCount: null, taskCount: 0, ...extra,
});

describe('projectKeyOf', () => {
  it('chuẩn hóa dấu gạch, dấu gạch cuối và hoa thường', () => {
    expect(projectKeyOf('D:\\Projects\\X\\')).toBe(projectKeyOf('d:/projects/x'));
    expect(projectKeyOf('/a/b///')).toBe('/a/b');
  });
  it('chuỗi rỗng giữ rỗng', () => {
    expect(projectKeyOf('')).toBe('');
  });
});

describe('tasksOfProject', () => {
  it('chọn đúng task dù khác hoa thường, dấu gạch, dấu gạch cuối', () => {
    const ts = [task('a', 'D:\\Projects\\X'), task('b', 'd:/projects/x/'), task('c', 'D:/Projects/Y')];
    expect(tasksOfProject(ts, { path: 'd:/PROJECTS/x' }).map((t) => t.id)).toEqual(['a', 'b']);
  });
  it('không chọn nhầm dự án cùng tiền tố', () => {
    const ts = [task('a', '/a/proj'), task('b', '/a/proj2')];
    expect(tasksOfProject(ts, { path: '/a/proj' }).map((t) => t.id)).toEqual(['a']);
    expect(tasksOfProject(ts, { path: '/a/proj2' }).map((t) => t.id)).toEqual(['b']);
  });
  it('đầu vào rỗng và repoPath rỗng/tương đối không khớp', () => {
    expect(tasksOfProject([], { path: '/a' })).toEqual([]);
    const ts = [task('a', ''), task('b', 'proj')];
    expect(tasksOfProject(ts, { path: '/a/proj' })).toEqual([]);
  });
});

describe('describeProjectSources', () => {
  it('thứ tự ổn định bất kể thứ tự đầu vào', () => {
    const p = project('x', 1, {
      sources: [{ source: 'antigravity', lastUsedAt: 1 }, { source: 'claude', lastUsedAt: 2 }],
    });
    expect(describeProjectSources(p)).toEqual(['Claude', 'Antigravity']);
  });
  it('có Codex, bỏ trùng, rỗng thì rỗng', () => {
    const p = project('x', 1, {
      sources: [{ source: 'codex', lastUsedAt: 1 }, { source: 'claude', lastUsedAt: 1 }, { source: 'claude', lastUsedAt: 2 }],
    });
    expect(describeProjectSources(p)).toEqual(['Claude', 'Codex']);
    expect(describeProjectSources(project('y', null))).toEqual([]);
  });
});

describe('sortProjects', () => {
  it('thời gian giảm dần, null cuối, hòa theo tên không phân biệt hoa thường', () => {
    const ps = [project('b', 5), project('n', null), project('A', 5), project('c', 9), project('a2', null)];
    expect(sortProjects(ps).map((p) => p.name)).toEqual(['c', 'A', 'b', 'a2', 'n']);
  });
  it('không sửa mảng đầu vào; mảng rỗng', () => {
    const ps = [project('b', 1), project('a', 2)];
    const copy = [...ps];
    sortProjects(ps);
    expect(ps).toEqual(copy);
    expect(sortProjects([])).toEqual([]);
  });
  it('tên Unicode hòa nhau vẫn có thứ tự xác định', () => {
    const ps = [project('Đông', 1), project('Ánh', 1), project('Bình', 1)];
    const a = sortProjects(ps).map((p) => p.name);
    const b = sortProjects([...ps].reverse()).map((p) => p.name);
    expect(a).toEqual(b);
    expect(a.indexOf('Ánh')).toBeLessThan(a.indexOf('Bình'));
  });
});

describe('filterProjects / formatLastUsed', () => {
  it('lọc theo tên hoặc đường dẫn, không phân biệt hoa thường; rỗng giữ nguyên', () => {
    const ps = [project('Alpha', 1), project('beta', 2, { path: 'D:/Work/ALPHA-x' })];
    expect(filterProjects(ps, 'alpha').map((p) => p.name)).toEqual(['Alpha', 'beta']);
    expect(filterProjects(ps, ' BET ').map((p) => p.name)).toEqual(['beta']);
    expect(filterProjects(ps, '')).toBe(ps);
    expect(filterProjects(ps, 'zzz')).toEqual([]);
  });
  it('định dạng thời gian cục bộ', () => {
    expect(formatLastUsed(null)).toBe('chưa rõ');
    expect(formatLastUsed(new Date(2026, 10, 5, 9, 7).getTime())).toBe('2026-11-05 09:07');
  });
});

describe('effectiveChoice', () => {
  const ps = [project('x', 1, { path: 'D:/Work/X' })];
  it('ưu tiên lựa chọn của người dùng', () => {
    expect(effectiveChoice('/q', ps, 'D:/work/x')).toBe('/q');
  });
  it('đặt sẵn dự án đang xem (khớp khóa), không có thì Thư mục khác', () => {
    expect(effectiveChoice(null, ps, 'd:/work/x/')).toBe('D:/Work/X');
    expect(effectiveChoice(null, ps, '/lạ')).toBe(OTHER);
  });
  it('không xem dự án nào: rỗng, hoặc Thư mục khác khi danh sách rỗng', () => {
    expect(effectiveChoice(null, ps, null)).toBe('');
    expect(effectiveChoice(null, [], null)).toBe(OTHER);
  });
});

describe('taskIdOf', () => {
  it('giải mã id; hash hỏng hoặc không phải task thì null, không ném lỗi', () => {
    expect(taskIdOf('#/task/abc%20d')).toBe('abc d');
    expect(taskIdOf('#/task/%')).toBeNull();
    expect(taskIdOf('#/board')).toBeNull();
  });
});

describe('resolveProjectRoute', () => {
  const ps = [project('x', 1, { path: 'D:/Work/X' })];
  const hashOf = (p: string): string => `#/project/${encodeURIComponent(p)}`;
  it('không phải hash dự án: danh sách', () => {
    expect(resolveProjectRoute('', ps, 'loaded')).toEqual({ view: 'list' });
    expect(resolveProjectRoute('#/board', ps, 'loaded')).toEqual({ view: 'list' });
  });
  it('đang tải hoặc tải lỗi: giữ nguyên, không chuyển hướng', () => {
    expect(resolveProjectRoute(hashOf('/lạ'), null, 'loading')).toEqual({ view: 'project', path: '/lạ' });
    expect(resolveProjectRoute(hashOf('/lạ'), ps, 'failed')).toEqual({ view: 'project', path: '/lạ' });
  });
  it('đã tải và khớp (theo khóa): màn dự án', () => {
    expect(resolveProjectRoute(hashOf('d:/work/x/'), ps, 'loaded')).toEqual({ view: 'project', path: 'd:/work/x/' });
  });
  it('đã tải nhưng không khớp: về danh sách kèm thông báo', () => {
    expect(resolveProjectRoute(hashOf('/lạ'), ps, 'loaded')).toEqual({
      view: 'list',
      notice: 'Không tìm thấy dự án đã chọn (có thể thư mục đã bị xóa hoặc đổi tên).',
    });
  });
  it('hash hỏng: danh sách', () => {
    expect(resolveProjectRoute('#/project/%', ps, 'loaded')).toEqual({ view: 'list' });
    expect(resolveProjectRoute('#/project/%', null, 'loading')).toEqual({ view: 'list' });
  });
});
