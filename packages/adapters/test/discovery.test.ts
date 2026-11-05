import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverAll,
  discoverAntigravityProjects,
  discoverClaudeProjects,
  fileUriToPath,
} from '../src/index.js';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'voragent-disc-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const sorted = (xs: { path: string }[]) => xs.map((x) => x.path).sort();

async function session(dir: string, file: string, content: string, mtimeSec?: number) {
  const d = join(home, '.claude', 'projects', dir);
  await mkdir(d, { recursive: true });
  const f = join(d, file);
  await writeFile(f, content);
  if (mtimeSec !== undefined) await utimes(f, mtimeSec, mtimeSec);
}

describe('fileUriToPath', () => {
  it('giải mã URI file trên win32', () => {
    expect(fileUriToPath('file:///d%3A/My%20Dir/D%E1%BB%B1%20%C3%A1n', 'win32')).toBe('d:\\My Dir\\Dự án');
  });
  it('POSIX trả đường dẫn đã giải mã', () => {
    expect(fileUriToPath('file:///home/u/x', 'linux')).toBe('/home/u/x');
  });
  it('URI có host: UNC trên win32, null trên POSIX, localhost như rỗng', () => {
    expect(fileUriToPath('file://server/share/My%20Dir/x', 'win32')).toBe('\\\\server\\share\\My Dir\\x');
    expect(fileUriToPath('file://localhost/d%3A/x', 'win32')).toBe('d:\\x');
    expect(fileUriToPath('file://server/share/x', 'linux')).toBeNull();
    expect(fileUriToPath('file://localhost/home/u/x', 'linux')).toBe('/home/u/x');
  });
  it('các trường hợp biên giữ nguyên', () => {
    expect(fileUriToPath('file:///d%ZZ/x', 'win32')).toBeNull();
    expect(fileUriToPath('', 'win32')).toBeNull();
    expect(fileUriToPath('FILE:///d%3A/x', 'win32')).toBe('d:\\x');
    expect(fileUriToPath('file:///D:/x', 'win32')).toBe('D:\\x');
    expect(fileUriToPath('file:///d%3A/x/', 'win32')).toBe('d:\\x\\');
  });
  it('URI không phải file hoặc rác trả null', () => {
    expect(fileUriToPath('vscode-remote://ssh/x', 'win32')).toBeNull();
    expect(fileUriToPath('khong phai uri', 'win32')).toBeNull();
  });
});

describe('discoverClaudeProjects', () => {
  it('trả khóa của projects, chưa dedupe', async () => {
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({ projects: { 'd:/Projects/a': {}, 'D:/Projects/a': {}, 'D:/Projects/b': {} } }),
    );
    const r = await discoverClaudeProjects({ home });
    expect(sorted(r)).toEqual(['D:/Projects/a', 'D:/Projects/b', 'd:/Projects/a']);
    expect(r.every((p) => p.source === 'claude' && p.lastUsedAt === null)).toBe(true);
  });

  it('lấy cwd từ phiên, bỏ qua dòng hỏng, lastUsedAt là mtime file', async () => {
    await session(
      'D--Projects-a',
      's1.jsonl',
      'not json\n{"cwd":"D:\\\\Projects\\\\a","sessionId":"s","timestamp":"2026-01-01T00:00:00Z"}\n',
      1_700_000_000,
    );
    const r = await discoverClaudeProjects({ home });
    expect(r).toEqual([{ path: 'D:\\Projects\\a', lastUsedAt: 1_700_000_000_000, source: 'claude' }]);
  });

  it('không giải mã tên thư mục', async () => {
    await session('zzz', 's.jsonl', '{"cwd":"D:\\\\Projects\\\\c"}\n', 1_700_000_000);
    expect(sorted(await discoverClaudeProjects({ home }))).toEqual(['D:\\Projects\\c']);
  });

  it('dùng file .jsonl mới nhất, bỏ qua file khác đuôi', async () => {
    await session('p', 'a-old.jsonl', '{"cwd":"/old"}\n', 1_600_000_000);
    await session('p', 'z-new.jsonl', '{"cwd":"/new"}\n', 1_700_000_000);
    await session('p', 'zzz.txt', '{"cwd":"/txt"}\n', 1_800_000_000);
    await session('p', 'zzz.jsonl.bak', '{"cwd":"/bak"}\n', 1_800_000_000);
    const r = await discoverClaudeProjects({ home });
    expect(r).toEqual([{ path: '/new', lastUsedAt: 1_700_000_000_000, source: 'claude' }]);
  });

  it('dòng đầu dài hơn 64 KB bị cắt thì bỏ thư mục, không ném lỗi', async () => {
    await session('cut', 's.jsonl', `{"cwd":"/cut","pad":"${'x'.repeat(70 * 1024)}"}\n`);
    expect(await discoverClaudeProjects({ home })).toEqual([]);
  });

  it('projects là mảng hoặc khóa rỗng thì bỏ qua', async () => {
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: ['/a', '/b'] }));
    expect(await discoverClaudeProjects({ home })).toEqual([]);
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { '': {}, '/ok': {} } }));
    expect(sorted(await discoverClaudeProjects({ home }))).toEqual(['/ok']);
  });

  it('gộp cùng đường dẫn, giữ thời gian lớn nhất', async () => {
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { '/x': {} } }));
    await session('p', 's.jsonl', '{"cwd":"/x"}\n', 1_700_000_000);
    const r = await discoverClaudeProjects({ home });
    expect(r).toEqual([{ path: '/x', lastUsedAt: 1_700_000_000_000, source: 'claude' }]);
  });

  it('nguồn hỏng trả mảng rỗng, không ném lỗi', async () => {
    expect(await discoverClaudeProjects({ home })).toEqual([]);
    await writeFile(join(home, '.claude.json'), 'không phải JSON');
    await session('empty', 's.jsonl', '');
    await session('nocwd', 's.jsonl', '{"a":1}\n{"b":2}\n');
    expect(await discoverClaudeProjects({ home })).toEqual([]);
  });

  it('đọc tối đa 64 KB đầu file', async () => {
    const pad = 'x'.repeat(1024 * 1024);
    await session('big', 's.jsonl', `{"cwd":"/big"}\n{"pad":"${pad}"}\n`);
    expect(sorted(await discoverClaudeProjects({ home }))).toEqual(['/big']);
    await session('late', 's.jsonl', `{"pad":"${'y'.repeat(70 * 1024)}"}\n{"cwd":"/late"}\n`);
    expect(sorted(await discoverClaudeProjects({ home }))).toEqual(['/big']);
  });

  it('xét tối đa 500 thư mục', async () => {
    for (let i = 0; i < 505; i++) await session(`d${i}`, 's.jsonl', `{"cwd":"/p${i}"}\n`);
    expect((await discoverClaudeProjects({ home })).length).toBe(500);
  });

  it('quá 500 thư mục thì giữ 500 thư mục có mtime mới nhất', async () => {
    for (let i = 0; i < 505; i++) {
      await session(`d${i}`, 's.jsonl', `{"cwd":"/p${i}"}
`);
      const d = join(home, '.claude', 'projects', `d${i}`);
      await utimes(d, 1_700_000_000 + i, 1_700_000_000 + i);
    }
    const r = sorted(await discoverClaudeProjects({ home }));
    expect(r.length).toBe(500);
    expect(r).not.toContain('/p0');
    expect(r).not.toContain('/p4');
    expect(r).toContain('/p5');
    expect(r).toContain('/p504');
  });
});

describe('discoverAntigravityProjects', () => {
  const ws = (...p: string[]) => join(home, 'AppData', 'Roaming', 'Antigravity', 'User', 'workspaceStorage', ...p);
  const opts = () => ({ home, appData: join(home, 'AppData', 'Roaming'), platform: 'win32' as const });

  it('đọc folder, bỏ workspace và file rỗng', async () => {
    await mkdir(ws('h1'), { recursive: true });
    await mkdir(ws('h2'), { recursive: true });
    await mkdir(ws('h3'), { recursive: true });
    await writeFile(ws('h1', 'workspace.json'), '{"folder":"file:///d%3A/Projects/x"}');
    await writeFile(ws('h2', 'workspace.json'), '{"workspace":"file:///d%3A/x.code-workspace"}');
    await writeFile(ws('h3', 'workspace.json'), '');
    await utimes(ws('h1'), 1_700_000_000, 1_700_000_000);
    const r = await discoverAntigravityProjects(opts());
    expect(r).toEqual([{ path: 'd:\\Projects\\x', lastUsedAt: 1_700_000_000_000, source: 'antigravity' }]);
  });

  it('nguồn không tồn tại trả []', async () => {
    expect(await discoverAntigravityProjects(opts())).toEqual([]);
  });
});

describe('discoverAll', () => {
  it('một nguồn ném lỗi vẫn trả kết quả nguồn còn lại', async () => {
    await writeFile(join(home, '.claude.json'), JSON.stringify({ projects: { '/ok': {} } }));
    const r = await discoverAll({ home, appData: 123 as unknown as string });
    expect(sorted(r)).toEqual(['/ok']);
  });
});

describe('discoverAntigravityProjects: giới hạn và cô lập môi trường', () => {
  const store = (root: string, ...p: string[]) =>
    join(root, 'AppData', 'Roaming', 'Antigravity', 'User', 'workspaceStorage', ...p);

  async function entry(root: string, name: string, folder: string, mtimeSec?: number) {
    await mkdir(store(root, name), { recursive: true });
    await writeFile(store(root, name, 'workspace.json'), JSON.stringify({ folder }));
    if (mtimeSec !== undefined) await utimes(store(root, name), mtimeSec, mtimeSec);
  }

  it('không đọc process.env.APPDATA khi chỉ có home', async () => {
    const other = await mkdtemp(join(tmpdir(), 'voragent-disc-env-'));
    const old = process.env.APPDATA;
    try {
      await entry(other, 'x', 'file:///d%3A/decoy');
      await entry(home, 'y', 'file:///d%3A/mine');
      process.env.APPDATA = join(other, 'AppData', 'Roaming');
      const r = await discoverAntigravityProjects({ home, platform: 'win32' });
      expect(r.map((x) => x.path)).toEqual(['d:\\mine']);
    } finally {
      if (old === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = old;
      await rm(other, { recursive: true, force: true });
    }
  });

  it('quá 500 mục thì giữ 500 mục có mtime mới nhất', async () => {
    for (let i = 0; i < 505; i++) await entry(home, `h${i}`, `file:///d%3A/p${i}`, 1_700_000_000 + i);
    const r = (await discoverAntigravityProjects({ home, platform: 'win32' })).map((x) => x.path);
    expect(r.length).toBe(500);
    expect(r).not.toContain('d:\\p0');
    expect(r).not.toContain('d:\\p4');
    expect(r).toContain('d:\\p5');
    expect(r).toContain('d:\\p504');
  });
});
