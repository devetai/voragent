# voragent giai đoạn 1b (khám phá dự án) — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Mục tiêu:** voragent tự nhận ra các dự án người dùng đã mở bằng Claude Code và Antigravity IDE, hiện thành danh sách để chọn dự án rồi giao task, thay cho việc gõ đường dẫn.

**Kiến trúc:** mỗi nguồn là một hàm chỉ đọc trong `packages/adapters` trả về đường dẫn thô; `packages/core` gộp, chuẩn hóa, lọc, làm giàu bằng thông tin git và nhớ kết quả; server mở `GET /api/projects`; CLI thêm `voragent projects` và cho `add` nhận tên dự án; web có màn hình danh sách dự án làm trang đầu.

**Công nghệ:** như giai đoạn 1 (TypeScript, Node ≥ 22.13, vitest, React). Không thêm thư viện mới.

**Spec:** [docs/superpowers/specs/2026-11-04-voragent-design.md](../specs/2026-11-04-voragent-design.md), mục 14. Người thực hiện đọc cả spec lẫn kế hoạch này.

## Ràng buộc chung

- Chạy thẳng trên Windows 11 (chính), macOS, Linux; không gọi `sh`; git qua `cross-spawn` với mảng đối số. Mọi script `package.json` chạy được trên cả Windows lẫn POSIX.
- **Chỉ đọc** thư mục của công cụ khác. Không ghi, không đổi, không đọc nội dung hội thoại ngoài việc lấy trường `cwd`, `sessionId`, `timestamp`. Không gửi dữ liệu ra ngoài máy, không ghi đường dẫn dự án vào log.
- **Test không bao giờ đọc thư mục chính thật của người dùng.** Mọi nguồn nhận `home` (và `appData`) làm tham số; test dựng thư mục giả trong thư mục tạm. Daemon lấy `home` từ `os.homedir()`, cho phép ghi đè bằng biến môi trường `VORAGENT_USER_HOME` (dùng cho test và demo).
- Một nguồn lỗi hay thiếu file thì trả mảng rỗng, không ném lỗi và không làm hỏng danh sách của nguồn khác.
- Khóa so sánh đường dẫn: `realpath`, viết thường trên Windows. Tên thư mục trong `~/.claude/projects` không bao giờ được giải mã ngược.
- Lệnh git chỉ đọc: dùng `git --no-optional-locks status --porcelain`; mỗi lệnh có giới hạn 3 giây (hết giờ thì kill cả cây tiến trình, giá trị `null`); chạy song song tối đa 4.
- Cuộc quét Claude đọc tối đa 64 KB đầu của file `.jsonl` mới nhất mỗi thư mục dự án, tối đa 500 thư mục dự án.
- Văn bản người dùng thấy bằng tiếng Việt; mã và định danh bằng tiếng Anh. Commit message không có dòng ghi công AI. Khi merge vào `main`, squash thành một commit (quy tắc trong CLAUDE.md).
- Môi trường máy này: `eval "$(fnm env --shell bash)"`, `export PATH="/d/.ai-agents/Claude/bin:$PATH"`, `TEMP`/`TMP`/`TMPDIR` trỏ `D:\.ai-agents\Claude\temp`; `pnpm install --config.confirmModulesPurge=false`; chạy test bằng `pnpm exec vitest run <file>` từ gốc repo; chạy `pnpm -r build` trước khi test gói phụ thuộc.

## Những lỗi dễ gặp nhất mà test thường bỏ sót

1. **Cùng một thư mục xuất hiện hai lần** vì khác hoa thường hoặc dấu gạch (`d:/Projects/x` và `D:\Projects\x`), hoặc vì một nguồn ghi đường dẫn có dấu gạch cuối. Kết quả mong đợi: một dự án, `lastUsedAt` lớn nhất, đủ các nguồn.
2. **Rác lọt vào danh sách:** thư mục tạm, worktree của chính voragent, thư mục dữ liệu của công cụ (`~/.gemini/antigravity`), thư mục chính của người dùng. Kết quả mong đợi: bị loại, kể cả khi chúng đứng đầu theo thời gian.
3. **Đường dẫn có dấu cách, ký tự tiếng Việt, hoặc mã hóa phần trăm trong URI** (`file:///d%3A/My%20Projects/Dự%20án`). Kết quả mong đợi: đúng đường dẫn thật.
4. **Một nguồn hỏng không được làm sập cả danh sách**: `~/.claude.json` không phải JSON, file `workspace.json` rỗng, `.jsonl` có dòng cụt, thư mục không đọc được. Kết quả mong đợi: bỏ mục đó, giữ phần còn lại.
5. **Lệnh git treo hoặc chậm** trên một thư mục ổ mạng hoặc repo khổng lồ. Kết quả mong đợi: danh sách vẫn trả về trong thời gian hữu hạn, trường git là `null`.

---

## Cấu trúc file

```text
packages/shared/src/index.ts              thêm DiscoveredProject, ProjectSource, Project
packages/adapters/src/discovery/uri.ts    fileUriToPath
packages/adapters/src/discovery/claude.ts discoverClaudeProjects
packages/adapters/src/discovery/antigravity.ts discoverAntigravityProjects
packages/adapters/src/discovery/index.ts  discoverAll
packages/core/src/projects.ts             createProjectCatalog, normalizePathKey, isIgnoredProjectPath
packages/core/src/server.ts               thêm GET /api/projects
packages/core/src/daemon.ts               dựng catalog, VORAGENT_USER_HOME, tùy chọn projectSources
packages/cli/src/cli.ts                   voragent projects, add nhận tên dự án
packages/web/src/ProjectList.tsx          màn hình danh sách dự án
packages/web/src/state.ts, App.tsx, Board.tsx, NewTaskForm.tsx, api.ts   chỉnh theo dự án
```

---

### Task 1: Kiểu dữ liệu chung và các nguồn khám phá

**Files:**

- Modify: `packages/shared/src/index.ts`
- Create: `packages/adapters/src/discovery/uri.ts`, `claude.ts`, `antigravity.ts`, `index.ts`; export từ `packages/adapters/src/index.ts`
- Test: `packages/adapters/test/discovery.test.ts`

**Interfaces:**

- Produces:

```ts
// @voragent/shared
export type DiscoverySource = 'claude' | 'antigravity' | 'codex';
export interface DiscoveredProject { path: string; lastUsedAt: number | null; source: DiscoverySource }
export interface ProjectSource { source: DiscoverySource; lastUsedAt: number | null }
export interface Project { id: string; path: string; name: string; lastUsedAt: number | null;
  sources: ProjectSource[]; isGit: boolean; branch: string | null; dirtyCount: number | null; taskCount: number }
// @voragent/adapters
export interface DiscoverOptions { home: string; appData?: string; platform?: NodeJS.Platform }
export function fileUriToPath(uri: string, platform?: NodeJS.Platform): string | null;
export function discoverClaudeProjects(o: DiscoverOptions): Promise<DiscoveredProject[]>;
export function discoverAntigravityProjects(o: DiscoverOptions): Promise<DiscoveredProject[]>;
export function discoverAll(o: DiscoverOptions): Promise<DiscoveredProject[]>;   // gộp, không dedupe; nguồn lỗi thì bỏ qua
```

Cách đọc:

- `fileUriToPath`: `file:///d%3A/My%20Dir/Dự%20án` → trên win32 `d:\My Dir\Dự án`, trên POSIX `/d:/...` không dùng được nên trả đường dẫn POSIX đúng của URI; URI không phải `file:` (ví dụ `vscode-remote://`) trả `null`.
- `discoverClaudeProjects`: khóa của `projects` trong `<home>/.claude.json` (thời gian `null` nếu không có thông tin khác), cộng mỗi thư mục con của `<home>/.claude/projects`: lấy file `.jsonl` có thời gian sửa mới nhất làm `lastUsedAt`, đọc tối đa 64 KB đầu file đó để lấy `cwd` đầu tiên (dòng cụt hoặc không phải JSON thì bỏ qua); không có `cwd` thì bỏ thư mục đó. Cùng một đường dẫn xuất hiện ở hai chỗ thì gộp bằng cách giữ thời gian lớn nhất (cùng khóa chuẩn hóa chuỗi thô; việc chuẩn hóa thật nằm ở core).
- `discoverAntigravityProjects`: `<appData>/Antigravity/User/workspaceStorage/*/workspace.json` (Windows: `appData` mặc định `%APPDATA%`; macOS: `<home>/Library/Application Support`; Linux: `<home>/.config`), trường `folder` qua `fileUriToPath`; trường `workspace` (file `.code-workspace`) bỏ qua; `lastUsedAt` là thời gian sửa thư mục con.

- [ ] **Step 1: Viết test** trong `discovery.test.ts`, dựng thư mục `home` giả bằng `mkdtemp` (dọn trong `afterEach`):
  - `fileUriToPath('file:///d%3A/My%20Dir/D%E1%BB%B1%20%C3%A1n', 'win32') === 'd:\\My Dir\\Dự án'`; `'vscode-remote://ssh/x'` → `null`; chuỗi rác → `null`.
  - Claude: `.claude.json` có `projects` với `'d:/Projects/a'` và `'D:/Projects/a'` cùng `'D:/Projects/b'` → cả ba được trả về (chưa dedupe); thư mục `.claude/projects/D--Projects-a/s1.jsonl` có dòng đầu hỏng, dòng thứ hai `{"cwd":"D:\\Projects\\a","sessionId":"s","timestamp":"..."}` → trả `D:\Projects\a` với `lastUsedAt` bằng thời gian sửa file (đặt bằng `utimes`); thư mục tên mã hóa không bao giờ được giải mã (tên thư mục là `zzz` mà `cwd` là `D:\Projects\c` → kết quả là `D:\Projects\c`).
  - Claude hỏng: `.claude.json` không phải JSON, file `.jsonl` rỗng, thư mục không có `cwd` → mảng rỗng, không ném lỗi; không có `.claude` → `[]`.
  - Giới hạn: file `.jsonl` 1 MB mà `cwd` nằm ở dòng đầu vẫn đọc được; `cwd` chỉ nằm sau 64 KB thì bỏ qua.
  - Antigravity: `workspaceStorage/h1/workspace.json` `{"folder":"file:///d%3A/Projects/x"}` → `d:\Projects\x`; `h2` có `{"workspace":"file:///d%3A/x.code-workspace"}` → bỏ; `h3` rỗng → bỏ; nguồn không tồn tại → `[]`.
  - `discoverAll`: một nguồn ném lỗi (mô phỏng bằng nhà không đọc được) vẫn trả kết quả của nguồn còn lại.
- [ ] **Step 2: Chạy và xác nhận fail.** `pnpm exec vitest run packages/adapters/test/discovery.test.ts`
- [ ] **Step 3: Viết kiểu chung và bốn module** theo giao diện trên. `statSync`/`readFileSync` bọc `try/catch` từng mục.
- [ ] **Step 4: Chạy và xác nhận pass,** rồi `pnpm -r build && pnpm -r typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "feat(adapters): discover projects opened with Claude Code and Antigravity"`

---

### Task 2: Danh mục dự án trong core

**Files:**

- Create: `packages/core/src/projects.ts`; export từ `packages/core/src/index.ts`
- Test: `packages/core/test/projects.test.ts`

**Interfaces:**

- Consumes: `DiscoveredProject`, `Project` (Task 1), `Store.listTasks()`.
- Produces:

```ts
export interface ProjectCatalogDeps {
  sources: Array<() => Promise<DiscoveredProject[]>>;
  store: Pick<Store, 'listTasks'>;
  dataDir: string;
  home: string;
  tmpDirs?: string[];                 // mặc định [os.tmpdir()]
  now?: () => number;
  ttlMs?: number;                     // mặc định 30_000
}
export interface ProjectCatalog { list(opts?: { refresh?: boolean }): Promise<Project[]> }
export function createProjectCatalog(d: ProjectCatalogDeps): ProjectCatalog;
export function normalizePathKey(p: string, platform?: NodeJS.Platform): string;   // realpath nếu có, bỏ dấu gạch cuối, viết thường trên win32
export function isIgnoredProjectPath(key: string, d: { dataDir: string; home: string; tmpDirs: string[] }, platform?: NodeJS.Platform): boolean;
```

Quy tắc theo spec 14.3. `id` là 12 ký tự đầu của sha1 của khóa chuẩn hóa. `taskCount` đếm task có `normalizePathKey(task.repoPath)` bằng khóa dự án. Sắp xếp theo `lastUsedAt` giảm dần, `null` xuống cuối, hòa thì theo `name`.

- [ ] **Step 1: Viết test** (repo git tạm bằng `git init`, `core.autocrlf=false`, cấu hình người dùng cục bộ; nguồn là hàm giả trả danh sách dựng sẵn):
  - Lỗi 1: nguồn trả `<tmp>/Repo`, `<tmp>/repo/` (khác hoa thường, dấu gạch cuối) và đường dẫn dùng `\`/`/` lẫn lộn → đúng một dự án trên win32 (`platform: 'win32'` truyền vào hàm thuần; phần realpath thật chỉ kiểm trên máy hiện tại), `lastUsedAt` lớn nhất, `sources` gồm cả `claude` và `antigravity`.
  - Lỗi 2: loại thư mục chính (`home`), `home/.gemini/antigravity`, `home/.claude`, `home/.voragent/x`, thư mục trong `dataDir/worktrees/task-1`, thư mục trong `tmpDirs`; thư mục không tồn tại; đường dẫn trỏ tới một file thường. Mỗi trường hợp đứng đầu theo thời gian vẫn bị loại.
  - Làm giàu: repo git có một file sửa dở và một file chưa theo dõi → `isGit true`, `branch` đúng, `dirtyCount 2`; thư mục thường → `isGit false`, `branch null`, `dirtyCount null`; `taskCount` đếm đúng khi store có hai task trên repo đó (một task ghi đường dẫn khác hoa thường).
  - Chỉ đọc: sau khi `list()`, `.git/index` của repo thử có byte giống hệt trước đó.
  - Lỗi 4/5: một nguồn ném lỗi → vẫn trả kết quả nguồn kia; lệnh git bị giả lập quá 3 giây (đưa vào một hàm `runGit` có thể thay trong `deps` chỉ cho test, mặc định là cross-spawn) → `branch null`, và `list()` xong trong thời gian hữu hạn (giới hạn thời gian giả lập nhỏ qua tùy chọn `gitTimeoutMs`, mặc định 3000).
  - Bộ nhớ đệm: hai lần `list()` liền nhau chỉ gọi nguồn một lần; `refresh: true` gọi lại; sau `ttlMs` (đồng hồ `now` giả) gọi lại.
  - Sắp xếp: thứ tự theo `lastUsedAt`, `null` cuối, hòa theo tên.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `projects.ts`.** Song song tối đa 4 bằng một hàng đợi nhỏ tự viết (không thêm thư viện); `git --no-optional-locks -C <path> rev-parse --is-inside-work-tree`, `branch --show-current`, `status --porcelain`; dùng lại cách tắt cây tiến trình của `proc.ts` nếu hợp, hoặc kill đơn giản vì lệnh git ngắn (ghi chọn lựa vào báo cáo).
- [ ] **Step 4: Chạy lại và xác nhận pass,** cùng `pnpm -r build && pnpm -r typecheck`.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): project catalog with normalization, filtering and git enrichment"`

---

### Task 3: API, daemon và CLI

**Files:**

- Modify: `packages/core/src/server.ts`, `packages/core/src/daemon.ts`, `packages/cli/src/cli.ts`
- Test: `packages/core/test/server.test.ts`, `packages/cli/test/main.test.ts` (thêm ca mới)

**Interfaces:**

- Consumes: `ProjectCatalog` (Task 2), `discoverAll` (Task 1).
- Produces: `GET /api/projects` (khóa, `?refresh=1`) trả `Project[]`; `createServer` nhận thêm `projects?: ProjectCatalog` (không có thì trả `[]`); `startDaemon` nhận thêm `projectSources?: ProjectCatalogDeps['sources']` và `userHome?: string` (mặc định `process.env.VORAGENT_USER_HOME ?? os.homedir()`); CLI `voragent projects`; `voragent add <dự-án-hoặc-đường-dẫn> <tin nhắn…>`.

Quy tắc `add` (spec 14.4): tham số đầu là thư mục tồn tại thì dùng làm `repoPath`; nếu không thì hỏi daemon `GET /api/projects` và tìm theo tên (khớp chính xác không phân biệt hoa thường; nếu không có thì khớp một phần với đúng một kết quả); không thấy hoặc trùng thì in lỗi tiếng Việt kèm các đường dẫn ứng viên, thoát mã 1. `voragent projects` in bảng: tên, đường dẫn, lần dùng cuối (`YYYY-MM-DD HH:mm` hoặc `-`), nguồn, nhánh, số file sửa dở, số task. Cảnh báo không phải repo git khi `add` giữ nguyên.

- [ ] **Step 1: Viết test.** Server (dùng nguồn giả và `dataDir`/`userHome` tạm): 401 khi thiếu khóa; 200 với danh sách đúng và đúng thứ tự; `?refresh=1` làm nguồn bị gọi lại; không truyền `projects` thì `[]`. CLI (daemon thật với `projectSources` giả): `projects` in đủ tên và nguồn; `add tenduan "msg"` tạo task trên đúng đường dẫn (kiểm `repoPath` qua API); `add` với tên trùng ở hai thư mục → mã 1 và liệt kê cả hai đường dẫn; tên không có → mã 1 và thông báo; `add <thư mục thật>` vẫn hoạt động như cũ; tên khớp một phần duy nhất thì nhận; không có daemon → thông báo `Daemon chưa chạy. Chạy: voragent` như cũ.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết route, nối `startDaemon`, viết hai lệnh CLI.** Test không bao giờ chạm `os.homedir()` thật: nếu `userHome` không được truyền thì test phải đặt `VORAGENT_USER_HOME`.
- [ ] **Step 4: Chạy lại và xác nhận pass,** rồi chạy toàn bộ bộ test 3 lần liên tiếp.
- [ ] **Step 5: Commit.** `git commit -m "feat: projects API, voragent projects and project names in add"`

---

### Task 4: Giao diện web

**Files:**

- Create: `packages/web/src/ProjectList.tsx`
- Modify: `packages/web/src/state.ts`, `api.ts`, `App.tsx`, `Board.tsx`, `NewTaskForm.tsx`, `styles.css`, `README.md`
- Test: `packages/web/test/projects.test.ts`

**Interfaces:**

- Consumes: `GET /api/projects` (`Project[]`).
- Produces (`state.ts`, thuần): `projectKeyOf(path: string): string` (đổi `\` thành `/`, bỏ dấu gạch cuối, viết thường); `tasksOfProject(tasks: Task[], project: Pick<Project,'path'>): Task[]`; `describeProjectSources(p: Project): string[]` (nhãn tiếng Việt như `Claude`, `Antigravity`); `sortProjects(ps: Project[]): Project[]`.

Giao diện (đơn giản): thanh tab trên cùng `Dự án` / `Bảng task` (tất cả task) và khi đang ở một dự án thì có đường dẫn vụn `Dự án › <tên>`; `ProjectList` là màn hình mở đầu, mỗi dòng có tên, đường dẫn, lần dùng cuối, huy hiệu nguồn, nhánh, số file sửa dở, số task và huy hiệu "không phải repo git"; ô lọc theo chữ ở đầu danh sách (lọc phía trình duyệt, không gọi API); bấm một dòng vào bảng task chỉ của dự án đó; `NewTaskForm` có ô chọn dự án (đặt sẵn dự án đang xem) và lựa chọn "Thư mục khác…" mở ô gõ đường dẫn; nút "Làm mới" gọi `?refresh=1`. Lỗi API hiện chuỗi `error` tiếng Việt từ máy chủ. Văn bản của dự án chỉ được render dạng văn bản, không `dangerouslySetInnerHTML`.

- [ ] **Step 1: Viết test** cho bốn hàm thuần: `projectKeyOf('D:\\Projects\\X\\')` bằng `projectKeyOf('d:/projects/x')`; `tasksOfProject` chọn đúng task khi `repoPath` khác hoa thường/dấu gạch; không chọn nhầm dự án có cùng tiền tố (`/a/proj` và `/a/proj2`); `describeProjectSources` trả thứ tự ổn định `['Claude','Antigravity']`; `sortProjects` theo thời gian giảm dần, `null` cuối, hòa theo tên, và không sửa mảng đầu vào.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết bốn hàm thuần, `ProjectList.tsx` và chỉnh các component.** Dữ liệu danh sách dự án tải một lần khi mở và khi bấm "Làm mới"; tải thất bại hiện lỗi, không làm trắng trang; lọc không gây tải lại.
- [ ] **Step 4: Chạy lại và xác nhận pass,** rồi `pnpm -r build && pnpm -r typecheck`. Cập nhật README: mục "Khám phá dự án" (nguồn đọc, quyền chỉ đọc, `VORAGENT_USER_HOME`, lệnh `voragent projects`, cách `add` nhận tên).
- [ ] **Step 5: Commit.** `git commit -m "feat(web): project list as the home screen and project-scoped board"`

---

### Task 5: Kiểm chứng trên dữ liệu thật

**Files:**

- Modify: `README.md` (mục "Đã kiểm với")

- [ ] **Step 1:** `pnpm -r build && pnpm -r typecheck`, chạy toàn bộ bộ test 3 lần liên tiếp.
- [ ] **Step 2:** Chạy daemon với `VORAGENT_HOME` tạm (không dùng `~/.voragent` thật) và **thư mục chính thật** (không đặt `VORAGENT_USER_HOME`, đây là lần duy nhất đọc dữ liệu thật; chỉ đọc), rồi `voragent projects` và `GET /api/projects`. Kiểm và ghi vào README (không dán đường dẫn riêng tư vào README; chỉ ghi số lượng và loại):
  - tổng số mục thô từ Claude (`~/.claude.json`) và từ Antigravity, tổng số dự án sau khi gộp, số mục bị loại theo từng lý do (không tồn tại, thư mục công cụ, thư mục tạm/worktree của voragent, thư mục chính);
  - không còn dự án trùng chỉ khác hoa thường hay dấu gạch;
  - thời gian `GET /api/projects` lần đầu và lần hai (đã nhớ đệm);
  - các dự án mà Claude đã mở nhưng không có trong danh sách và lý do (đối chiếu thủ công vài mục);
  - `voragent add <tên dự án>` trên một repo thử dùng một lần hoạt động.
- [ ] **Step 3:** Ghi rõ những gì chưa kiểm: Codex, `agy`, macOS/Linux, giao diện trong trình duyệt thật. Commit: `docs: record real-data verification of project discovery`.
