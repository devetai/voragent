import {
  mkdirSync,
  mkdtempSync,
  promises as fsp,
  readFileSync,
  realpathSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import spawn from 'cross-spawn';
import type { DiscoveredProject } from '@voragent/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProjectCatalog,
  isIgnoredProjectPath,
  normalizePathKey,
  type ProjectCatalogDeps,
} from '../src/projects.js';
import { rmTmp } from './helpers.js';

function git(cwd: string, args: string[]): string {
  const r = spawn.sync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

let root: string;
let home: string;
let dataDir: string;
let tmpA: string;
let work: string;

function mkRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'a.txt'), 'một\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'voragent-pc-')));
  home = join(root, 'home');
  dataDir = join(root, 'data');
  tmpA = join(root, 'tmpA');
  work = join(root, 'work');
  for (const d of [home, dataDir, tmpA, work]) mkdirSync(d, { recursive: true });
});

afterEach(() => {
  rmTmp(root);
});

function deps(
  list: DiscoveredProject[] | (() => Promise<DiscoveredProject[]>)[],
  extra: Partial<ProjectCatalogDeps> = {},
): ProjectCatalogDeps {
  const sources = (
    list.length > 0 && typeof list[0] === 'function'
      ? list
      : [async () => list as DiscoveredProject[]]
  ) as Array<() => Promise<DiscoveredProject[]>>;
  return {
    sources,
    store: { listTasks: () => [] },
    dataDir,
    home,
    tmpDirs: [tmpA],
    ...extra,
  };
}

describe('normalizePathKey', () => {
  it('win32: gạch chéo, gạch cuối và hoa thường cho cùng một khóa', () => {
    const a = normalizePathKey('D:\\Work\\Repo', 'win32');
    expect(normalizePathKey('d:/work/repo/', 'win32')).toBe(a);
    expect(normalizePathKey('d:\\WORK\\repo\\\\', 'win32')).toBe(a);
    expect(normalizePathKey('D:\\', 'win32')).toBe('d:\\');
  });
  it('posix: giữ hoa thường, bỏ gạch cuối', () => {
    expect(normalizePathKey('/nonexistent-x/Repo/', 'linux')).toBe('/nonexistent-x/Repo');
    expect(normalizePathKey('/nonexistent-x/repo', 'linux')).not.toBe('/nonexistent-x/Repo');
  });
});

describe('isIgnoredProjectPath', () => {
  const d = { dataDir: 'C:\\Data\\voragent', home: 'C:\\Users\\me', tmpDirs: ['C:\\Temp'] };
  it('không khớp anh em có chung tiền tố', () => {
    expect(isIgnoredProjectPath(normalizePathKey('C:\\Users\\me\\.claude2', 'win32'), d, 'win32')).toBe(false);
    expect(isIgnoredProjectPath(normalizePathKey('C:\\Users\\me\\.claude\\x', 'win32'), d, 'win32')).toBe(true);
    expect(isIgnoredProjectPath(normalizePathKey('C:\\Users\\ME', 'win32'), d, 'win32')).toBe(true);
    expect(isIgnoredProjectPath(normalizePathKey('C:\\Users\\me\\proj', 'win32'), d, 'win32')).toBe(false);
    expect(isIgnoredProjectPath(normalizePathKey('C:\\Temp2', 'win32'), d, 'win32')).toBe(false);
    expect(isIgnoredProjectPath(normalizePathKey('c:/data/VORAGENT/worktrees/task-1', 'win32'), d, 'win32')).toBe(true);
  });
  it('posix: /a/proj không nằm trong /a/pro', () => {
    const p = { dataDir: '/a/pro', home: '/h', tmpDirs: [] };
    expect(isIgnoredProjectPath('/a/proj', p, 'linux')).toBe(false);
    expect(isIgnoredProjectPath('/a/pro/x', p, 'linux')).toBe(true);
  });
});

describe('createProjectCatalog', () => {
  it('lỗi 1: trùng theo hoa thường/gạch cuối gộp thành một dự án', async () => {
    const repo = join(work, 'Repo');
    mkdirSync(repo);
    const variants = [repo, repo + '/', repo.replace(/\\/g, '/'), repo.toLowerCase() + '\\'];
    const cat = createProjectCatalog(
      deps([
        async () => [
          { path: variants[0]!, lastUsedAt: 100, source: 'claude' },
          { path: variants[1]!, lastUsedAt: 300, source: 'claude' },
        ],
        async () => [
          { path: variants[2]!, lastUsedAt: 200, source: 'antigravity' },
          { path: variants[3]!, lastUsedAt: null, source: 'antigravity' },
        ],
      ]),
    );
    const out = await cat.list();
    if (process.platform === 'win32') {
      expect(out).toHaveLength(1);
      expect(out[0]!.lastUsedAt).toBe(300);
      expect(out[0]!.sources).toEqual(
        expect.arrayContaining([
          { source: 'claude', lastUsedAt: 300 },
          { source: 'antigravity', lastUsedAt: 200 },
        ]),
      );
      expect(out[0]!.sources).toHaveLength(2);
      expect(out[0]!.path).toBe(repo);
      expect(out[0]!.name).toBe('Repo');
      expect(out[0]!.id).toMatch(/^[0-9a-f]{12}$/);
    } else {
      // posix: chỉ các biến thể trùng đúng khóa mới gộp
      expect(out.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('lỗi 2: loại rác dù mới nhất', async () => {
    const mk = (p: string): string => {
      mkdirSync(p, { recursive: true });
      return p;
    };
    const file = join(work, 'file.txt');
    writeFileSync(file, 'x');
    const good = mk(join(work, 'good dự án'));
    const junk = [
      home,
      mk(join(home, '.gemini', 'antigravity')),
      mk(join(home, '.claude')),
      mk(join(home, '.voragent', 'x')),
      mk(join(dataDir, 'worktrees', 'task-1')),
      mk(join(tmpA, 'scratch')),
      join(work, 'khong-ton-tai'),
      file,
    ];
    const cat = createProjectCatalog(
      deps([
        ...junk.map((p, i) => ({ path: p, lastUsedAt: 1_000_000 + i, source: 'claude' as const })),
        { path: good, lastUsedAt: 5, source: 'claude' },
      ]),
    );
    const out = await cat.list();
    expect(out.map((p) => p.path)).toEqual([good]);
    expect(out[0]!.name).toBe('good dự án');
  });

  it('làm giàu: repo git bẩn, thư mục thường, taskCount', async () => {
    const repo = join(work, 'my repo');
    mkRepo(repo);
    git(repo, ['checkout', '-q', '-b', 'nhanh-1']);
    writeFileSync(join(repo, 'a.txt'), 'sửa\n');
    writeFileSync(join(repo, 'new file.txt'), 'mới\n');
    const plain = join(work, 'plain');
    mkdirSync(plain);
    const task = (repoPath: string) => ({ repoPath }) as never;
    const cat = createProjectCatalog(
      deps(
        [
          { path: repo, lastUsedAt: 2, source: 'claude' },
          { path: plain, lastUsedAt: 1, source: 'claude' },
        ],
        {
          store: {
            listTasks: () => [task(repo), task(process.platform === 'win32' ? repo.toUpperCase() : repo)],
          },
        },
      ),
    );
    const out = await cat.list();
    const r = out.find((p) => p.path === repo)!;
    expect(r).toMatchObject({ isGit: true, branch: 'nhanh-1', dirtyCount: 2, taskCount: 2 });
    const pl = out.find((p) => p.path === plain)!;
    expect(pl).toMatchObject({ isGit: false, branch: null, dirtyCount: null, taskCount: 0 });
  });

  it('chỉ đọc: mọi lệnh git có cờ khóa/fsmonitor và status --porcelain', async () => {
    const repo = join(work, 'argv');
    mkdirSync(repo);
    const log = join(root, 'argv.log');
    const script = join(root, 'fakegit.js');
    writeFileSync(
      script,
      [
        'const a = process.argv.slice(2);',
        `require('fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');`,
        "if (a.includes('rev-parse')) process.stdout.write('true\\n');",
        "else if (a.includes('branch')) process.stdout.write('main\\n');",
      ].join('\n'),
    );
    const cat = createProjectCatalog(
      deps([{ path: repo, lastUsedAt: 1, source: 'claude' }], {
        gitCommand: { bin: process.execPath, prefixArgs: [script] },
      }),
    );
    const out = await cat.list();
    expect(out[0]).toMatchObject({ isGit: true, branch: 'main', dirtyCount: 0 });
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as string[]);
    expect(calls).toHaveLength(3);
    for (const a of calls) {
      expect(a.slice(0, 3)).toEqual(['-c', 'core.fsmonitor=false', '--no-optional-locks']);
      expect(a.slice(3, 5)).toEqual(['-C', realpathSync.native(repo)]);
    }
    expect(calls.map((a) => a[5])).toEqual(['rev-parse', 'branch', 'status']);
    expect(calls[2]).toContain('--porcelain');
  });

  // Repo mà `git status` thường SẼ ghi lại index: file đã commit bị đổi mtime nhưng nội dung giữ nguyên.
  function mkStaleRepo(dir: string): void {
    mkRepo(dir);
    const t = new Date(Date.now() + 5000);
    utimesSync(join(dir, 'a.txt'), t, t);
  }

  it('chỉ đọc: .git/index giữ nguyên byte (có đối chứng)', async () => {
    const control = join(work, 'control');
    mkStaleRepo(control);
    const cBefore = readFileSync(join(control, '.git', 'index'));
    git(control, ['status', '--porcelain']);
    const controlChanged = !readFileSync(join(control, '.git', 'index')).equals(cBefore);

    const repo = join(work, 'ro');
    mkStaleRepo(repo);
    const before = readFileSync(join(repo, '.git', 'index'));
    const cat = createProjectCatalog(deps([{ path: repo, lastUsedAt: 1, source: 'claude' }]));
    const out = await cat.list({ refresh: true });
    await cat.list({ refresh: true });
    expect(out[0]).toMatchObject({ isGit: true, dirtyCount: 0 });
    expect(readFileSync(join(repo, '.git', 'index')).equals(before)).toBe(true);
    // Đối chứng: `git status` thường trên repo cùng trạng thái có ghi lại index không (ghi nhận để báo cáo).
    console.info(`đối chứng: git status thường ${controlChanged ? 'ĐÃ' : 'KHÔNG'} ghi lại index`);
  });

  it('lỗi 4: một nguồn ném lỗi thì nguồn kia vẫn có kết quả', async () => {
    const p = join(work, 'ok');
    mkdirSync(p);
    const cat = createProjectCatalog(
      deps([
        async () => {
          throw new Error('hỏng');
        },
        () => {
          throw new Error('hỏng đồng bộ');
        },
        async () => [{ path: p, lastUsedAt: 1, source: 'antigravity' }],
      ]),
    );
    expect((await cat.list()).map((x) => x.path)).toEqual([p]);
  });

  it('lỗi 5: git treo thì branch null và list vẫn xong', async () => {
    const hung = join(work, 'hung');
    const fine = join(work, 'fine');
    mkdirSync(hung);
    mkdirSync(fine);
    const cat = createProjectCatalog(
      deps(
        [
          { path: hung, lastUsedAt: 2, source: 'claude' },
          { path: fine, lastUsedAt: 1, source: 'claude' },
        ],
        {
          gitTimeoutMs: 50,
          runGit: (args, cwd) => {
            if (cwd === hung) return new Promise<string | null>(() => {});
            if (args[0] === 'rev-parse') return Promise.resolve('true\n');
            if (args[0] === 'branch') return Promise.resolve('main\n');
            return Promise.resolve('');
          },
        },
      ),
    );
    const out = await cat.list();
    expect(out.find((p) => p.path === hung)).toMatchObject({ branch: null, dirtyCount: null });
    expect(out.find((p) => p.path === fine)).toMatchObject({ isGit: true, branch: 'main', dirtyCount: 0 });
  });

  it('chạy tối đa 4 lệnh git song song', async () => {
    const dirs = Array.from({ length: 10 }, (_, i) => {
      const p = join(work, `p${i}`);
      mkdirSync(p);
      return p;
    });
    let active = 0;
    let peak = 0;
    const cat = createProjectCatalog(
      deps(
        dirs.map((p) => ({ path: p, lastUsedAt: 1, source: 'claude' as const })),
        {
          runGit: async () => {
            active++;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 15));
            active--;
            return null;
          },
        },
      ),
    );
    await cat.list();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('bộ nhớ đệm: dùng lại, refresh, hết hạn, dùng chung lời gọi đang chạy', async () => {
    const p = join(work, 'c');
    mkdirSync(p);
    let calls = 0;
    let t = 1000;
    const src = async (): Promise<DiscoveredProject[]> => {
      calls++;
      return [{ path: p, lastUsedAt: 1, source: 'claude' }];
    };
    const cat = createProjectCatalog(deps([src], { now: () => t, ttlMs: 500, runGit: async () => null }));
    await Promise.all([cat.list(), cat.list()]);
    expect(calls).toBe(1);
    await cat.list();
    expect(calls).toBe(1);
    await cat.list({ refresh: true });
    expect(calls).toBe(2);
    t += 499;
    await cat.list();
    expect(calls).toBe(2);
    t += 2;
    await cat.list();
    expect(calls).toBe(3);
  });

  it('sắp xếp: lastUsedAt giảm dần, null cuối, hòa theo tên không phân biệt hoa thường', async () => {
    const names = ['b', 'A', 'c', 'z', 'm'];
    const times = [10, 10, 50, null, null];
    const items = names.map((n, i) => {
      const p = join(work, n + '-proj');
      mkdirSync(p);
      return { path: p, lastUsedAt: times[i]!, source: 'claude' as const };
    });
    const cat = createProjectCatalog(deps(items, { runGit: async () => null }));
    expect((await cat.list()).map((x) => x.name)).toEqual(['c-proj', 'A-proj', 'b-proj', 'm-proj', 'z-proj']);
  });

  it('bỏ đường dẫn tương đối và chuỗi rỗng dù tồn tại theo thư mục làm việc', async () => {
    const cat = createProjectCatalog(
      deps(
        [
          { path: 'packages', lastUsedAt: 9, source: 'claude' },
          { path: './packages', lastUsedAt: 9, source: 'claude' },
          { path: '.', lastUsedAt: 9, source: 'claude' },
          { path: '', lastUsedAt: 9, source: 'claude' },
        ],
        { runGit: async () => null },
      ),
    );
    expect(await cat.list()).toEqual([]);
  });

  it('task có repoPath tương đối không bao giờ khớp dự án', async () => {
    // Thư mục nằm TRONG cwd: đường dẫn tương đối sẽ trỏ đúng vào nó nếu bị giải theo cwd.
    const name = `.voragent-rel-${process.pid}-${Date.now()}`;
    const p = join(process.cwd(), name);
    mkdirSync(p);
    try {
      const cat = createProjectCatalog(
        deps([{ path: p, lastUsedAt: 1, source: 'claude' }], {
          runGit: async () => null,
          store: { listTasks: () => [{ repoPath: name } as never, { repoPath: p } as never] },
        }),
      );
      const out = await cat.list();
      expect(out.find((x) => x.path === realpathSync.native(p))?.taskCount).toBe(1);
    } finally {
      rmTmp(p);
    }
  });

  it('bản dựng cũ không ghi đè bản dựng mới trong bộ nhớ đệm', async () => {
    const pa = join(work, 'old-a');
    const pb = join(work, 'new-b');
    mkdirSync(pa);
    mkdirSync(pb);
    let releaseA!: () => void;
    let n = 0;
    const src = (): Promise<DiscoveredProject[]> => {
      n++;
      if (n === 1) {
        return new Promise((res) => {
          releaseA = () => res([{ path: pa, lastUsedAt: 1, source: 'claude' }]);
        });
      }
      return Promise.resolve([{ path: pb, lastUsedAt: 2, source: 'claude' }]);
    };
    const cat = createProjectCatalog(deps([src], { ttlMs: 60_000, now: () => 1000, runGit: async () => null }));
    const a = cat.list();
    const b = await cat.list({ refresh: true });
    expect(b.map((x) => x.path)).toEqual([pb]);
    releaseA();
    expect((await a).map((x) => x.path)).toEqual([pa]);
    expect((await cat.list()).map((x) => x.path)).toEqual([pb]);
    expect(n).toBe(2);
  });

  it('runGit mặc định: git treo thật bị kill sau gitTimeoutMs', async () => {
    const repo = join(work, 'hanggit');
    mkdirSync(repo);
    const pidFile = join(root, 'sleeper.pid');
    const script = join(root, 'sleeper.js');
    writeFileSync(
      script,
      `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000);`,
    );
    const alive = (pid: number): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    let pid = 0;
    const readPid = (): number => {
      try {
        return Number(readFileSync(pidFile, 'utf8')) || 0;
      } catch {
        return 0;
      }
    };
    try {
      const cat = createProjectCatalog(
        deps([{ path: repo, lastUsedAt: 1, source: 'claude' }], {
          gitTimeoutMs: 1500,
          gitCommand: { bin: process.execPath, prefixArgs: [script] },
        }),
      );
      const out = await cat.list();
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ isGit: false, branch: null, dirtyCount: null });
      for (let i = 0; i < 100 && readPid() === 0; i++) await new Promise((r) => setTimeout(r, 50));
      pid = readPid();
      expect(pid).toBeGreaterThan(0);
      const deadline = Date.now() + 15_000;
      while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(alive(pid)).toBe(false);
    } finally {
      pid = pid || readPid();
      if (pid && alive(pid)) process.kill(pid);
    }
  });

  it('runGit ném đồng bộ chỉ làm dự án đó mất thông tin git', async () => {
    const bad = join(work, 'bad');
    const ok = join(work, 'ok2');
    mkdirSync(bad);
    mkdirSync(ok);
    const cat = createProjectCatalog(
      deps(
        [
          { path: bad, lastUsedAt: 2, source: 'claude' },
          { path: ok, lastUsedAt: 1, source: 'claude' },
        ],
        {
          runGit: ((args: string[], cwd: string) => {
            if (cwd === bad) throw new Error('boom');
            return Promise.resolve(args[0] === 'rev-parse' ? 'true\n' : args[0] === 'branch' ? 'main\n' : '');
          }) as never,
        },
      ),
    );
    const out = await cat.list();
    expect(out.find((p) => p.path === bad)).toMatchObject({ isGit: false, branch: null, dirtyCount: null });
    expect(out.find((p) => p.path === ok)).toMatchObject({ isGit: true, branch: 'main' });
  });

  it('loại gốc ổ đĩa và tổ tiên của home/dataDir/tmp; giữ anh em và tiền tố chung', async () => {
    const homeParent = path.dirname(home);
    const dataParent = path.dirname(dataDir);
    const sibling = join(root, 'sibling');
    const home2 = join(root, 'home2');
    mkdirSync(sibling);
    mkdirSync(home2);
    const cat = createProjectCatalog(
      deps(
        [
          { path: path.parse(root).root, lastUsedAt: 99, source: 'claude' },
          { path: homeParent, lastUsedAt: 98, source: 'claude' },
          { path: dataParent, lastUsedAt: 97, source: 'claude' },
          { path: path.dirname(tmpA), lastUsedAt: 96, source: 'claude' },
          { path: sibling, lastUsedAt: 2, source: 'claude' },
          { path: home2, lastUsedAt: 1, source: 'claude' },
        ],
        { runGit: async () => null },
      ),
    );
    expect((await cat.list()).map((p) => p.path)).toEqual([sibling, home2]);
  });

  it('loại .codex và .antigravity trong home', async () => {
    const a = join(home, '.codex', 'x');
    const b = join(home, '.antigravity');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    const cat = createProjectCatalog(
      deps(
        [
          { path: a, lastUsedAt: 2, source: 'claude' },
          { path: b, lastUsedAt: 1, source: 'claude' },
        ],
        { runGit: async () => null },
      ),
    );
    expect(await cat.list()).toEqual([]);
  });

  it('đường dẫn treo (realpath không bao giờ trả về) bị bỏ sau pathTimeoutMs, phần còn lại vẫn đủ', async () => {
    const hung = join(work, 'dead-unc');
    const fine = join(work, 'fine2');
    mkdirSync(hung);
    mkdirSync(fine);
    const cat = createProjectCatalog(
      deps(
        [
          { path: hung, lastUsedAt: 2, source: 'claude' },
          { path: fine, lastUsedAt: 1, source: 'claude' },
        ],
        {
          runGit: async () => null,
          pathTimeoutMs: 100,
          fsOps: {
            realpath: (p) => (p === hung ? new Promise<string>(() => {}) : fsp.realpath(p)),
            stat: (p) => fsp.stat(p),
          },
        },
      ),
    );
    expect((await cat.list()).map((x) => x.path)).toEqual([fine]);
  });

  it('stat treo cũng bị bỏ; gốc loại trừ chỉ tra cứu một lần cho mỗi bản dựng', async () => {
    const dirs = Array.from({ length: 12 }, (_, i) => {
      const p = join(work, `many${i}`);
      mkdirSync(p);
      return p;
    });
    const calls = new Map<string, number>();
    const cat = createProjectCatalog(
      deps(
        dirs.map((p) => ({ path: p, lastUsedAt: 1, source: 'claude' as const })),
        {
          runGit: async () => null,
          pathTimeoutMs: 100,
          fsOps: {
            realpath: (p) => {
              calls.set(p, (calls.get(p) ?? 0) + 1);
              return fsp.realpath(p);
            },
            stat: (p) => (p === dirs[3] ? new Promise(() => {}) : fsp.stat(p)),
          },
        },
      ),
    );
    const out = await cat.list();
    expect(out).toHaveLength(11);
    expect(out.map((x) => x.path)).not.toContain(dirs[3]);
    for (const r of [home, dataDir, tmpA]) expect(calls.get(r)).toBe(1);
  });
});
