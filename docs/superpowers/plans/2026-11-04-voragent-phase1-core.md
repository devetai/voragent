# voragent giai đoạn 1 (lõi) — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Mục tiêu:** dựng lõi của voragent. Gồm một daemon trên máy nhận task dạng trò chuyện, chạy task bằng Claude Code hoặc Codex trong git worktree riêng, và tự bàn giao sang nền tảng khác khi hết quota. Kèm một web tối thiểu: bảng, dòng thời gian/chat, thanh quota.

**Kiến trúc:**

- Monorepo pnpm, gồm `shared` (kiểu dữ liệu), `adapters` (mỗi CLI một adapter, đổi output về sự kiện chung), `core` (SQLite, worktree, chạy tiến trình, bộ điều phối, HTTP/WebSocket), `cli` (lệnh `voragent`) và `web` (React).
- Bộ điều phối là vòng `tick()`: lấy các lượt đang chờ, chọn nền tảng, chạy CLI headless, ghi sự kiện, rồi xử lý kết quả theo ba nhánh: xong, hết quota, hoặc lỗi.

**Công nghệ:**

- TypeScript và Node ≥ 22.13. SQLite dùng `node:sqlite` có sẵn trong Node, không cần module native.
- Test bằng `vitest`. Gọi tiến trình con bằng `cross-spawn`.
- HTTP dùng `hono` và `@hono/node-server`, WebSocket dùng `ws`.
- Web dùng Vite và React 18.

**Spec:** [docs/superpowers/specs/2026-11-04-voragent-design.md](../specs/2026-11-04-voragent-design.md). Người thực hiện đọc cả spec lẫn kế hoạch này.

**Ngoài phạm vi kế hoạch này** (mỗi mục sẽ có kế hoạch riêng):

- văn phòng 3D (giai đoạn 2);
- hook và duyệt quyền, theo dõi phiên tay (giai đoạn 3);
- đồ thị, GitNexus, các adapter khác (giai đoạn 4).

## Ràng buộc chung

- Chạy thẳng trên Windows 11, macOS và Linux. Không gọi `sh`. Mọi script trong `package.json` phải chạy được trên cả Windows lẫn POSIX.
- Gọi tiến trình con bằng `cross-spawn`, để gọi được shim `.cmd` trên Windows. Yêu cầu và system prompt đưa qua **stdin**, không đưa qua đối số.
- Không bao giờ sửa thư mục làm việc chính của người dùng. Không tự merge nhánh.
- Nhánh của task tên là `voragent/task-<n>`, trong đó `<n>` là số thứ tự của task, tăng dần.
- Worktree có ba chế độ: `head-dirty-commit` (mặc định), `head-commit`, `dirty-nocommit`.
- Danh sách ưu tiên mặc định: `["claude", "codex"]`. Ngưỡng quota cho việc mới: `0.9`.
- Task ở lại nền tảng đang làm cho đến khi xong. Chỉ chuyển nền tảng khi nền tảng hiện tại hết quota.
- Lỗi không phải hết quota: thử lại 1 lần trên cùng nền tảng, sau đó đánh dấu task là lỗi.
- Daemon chỉ nghe ở `127.0.0.1`. Mọi request phải có khóa phiên, gửi qua header `x-voragent-key`, tham số `?key=` hoặc cookie `voragent_key`.
- Thư mục dữ liệu là `~/.voragent/`, gồm `voragent.db`, `config.json`, `daemon.json`, `worktrees/`, `daemon.log`.
- Các giá trị mặc định sau do agent tự quyết trong kế hoạch này (spec mục 13 để người xây quyết định):
  - thời gian tạm nghỉ khi không biết giờ được dùng lại: `3_600_000` ms;
  - thời gian chờ tối đa mỗi lượt: `1_800_000` ms;
  - số việc song song: `perProvider: 2`, `total: 4`;
  - cổng: `4717`;
  - giới hạn độ dài bản bàn giao: `24_000` ký tự.
- Mạng bật mặc định cho run. Với Codex, bật bằng `-c sandbox_workspace_write.network_access=true`.
- Văn bản hiện cho người dùng viết bằng tiếng Việt. Code và tên định danh viết bằng tiếng Anh.
- Trên máy dev, chạy `pnpm` qua `corepack pnpm` nếu `pnpm` chưa có trong PATH. Nạp Node bằng `eval "$(fnm env --shell bash)"`. Đặt `TEMP`, `TMP`, `TMPDIR` trỏ tới `D:\.ai-agents\Claude\temp` khi chạy test.

## Những lỗi dễ gặp nhất mà test thường bỏ sót

1. **Nhận nhầm hết quota.** Agent viết chữ "usage limit" trong câu trả lời bình thường, ví dụ khi sửa code xử lý rate limit. Kết quả mong đợi: **không** bị coi là hết quota. Chỉ xét sự kiện `result` hoặc `error` của CLI, stderr và mã thoát khác 0. Test nằm ở Task 4 và Task 5.
2. **Repo của người dùng đang có việc dở:** file đã sửa, file mới chưa được theo dõi, file đã xóa, file nhị phân. Kết quả mong đợi: worktree ở chế độ `head-dirty-commit` giống hệt trạng thái đó, còn thư mục chính không đổi chút nào. Test ở Task 7.
3. **Daemon bị tắt ngang khi đang chạy một lượt.** Kết quả mong đợi: khởi động lại thì lượt đó chạy tiếp bằng bản bàn giao, không bị chạy trùng hai lần, không mất tin nhắn. Test ở Task 10.
4. **Mọi nền tảng đều đang tạm nghỉ.** Kết quả mong đợi: task ở trạng thái `waiting_quota`, không báo lỗi, và tự chạy tiếp ngay khi một nền tảng hết thời gian tạm nghỉ. Test ở Task 10.
5. **Yêu cầu nhiều dòng có tiếng Việt và dấu ngoặc kép, chạy trên Windows qua shim `.cmd`.** Kết quả mong đợi: CLI nhận đúng nguyên văn. Test ở Task 6.

---

## Cấu trúc file

```text
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.workspace.ts
packages/shared/src/index.ts            kiểu dữ liệu dùng chung: Task, Turn, Run, VEvent, ProviderState, Config
packages/adapters/src/types.ts          Adapter, StreamParser, TurnResult
packages/adapters/src/common.ts         splitLines, parseResetTime, truncate
packages/adapters/src/claude.ts         adapter Claude Code
packages/adapters/src/codex.ts          adapter Codex
packages/adapters/src/fake.ts           adapter giả dùng trong test, phát lại fixture qua test/fake-cli.mjs
packages/adapters/src/index.ts          registry: createAdapters(config)
packages/adapters/test/fixtures/*.jsonl output CLI thu từ thực tế
packages/adapters/test/fake-cli.mjs     CLI giả
packages/core/src/store.ts              SQLite: lược đồ và truy vấn
packages/core/src/bus.ts                EventBus
packages/core/src/proc.ts               runTurn: chạy một lượt CLI
packages/core/src/workspace.ts          worktree, commit, diff
packages/core/src/config.ts             loadConfig, giá trị mặc định
packages/core/src/scheduler.ts          pickProvider (hàm thuần)
packages/core/src/handoff.ts            buildHandoff (hàm thuần)
packages/core/src/orchestrator.ts       createOrchestrator
packages/core/src/server.ts             HTTP API, WebSocket, phục vụ web
packages/core/src/daemon.ts             startDaemon: ghép mọi thứ lại
packages/cli/src/main.ts                lệnh voragent
packages/web/src/...                    giao diện tối thiểu
```

---

### Task 1: Dựng monorepo và kiểu dữ liệu chung

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.npmrc`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/index.test.ts`

**Interfaces:**

- Produces (`@voragent/shared`):

```ts
export type ProviderId = string;                       // 'claude' | 'codex' | 'fake-a' …
export type WorkspaceMode = 'head-dirty-commit' | 'head-commit' | 'dirty-nocommit';
export type TaskStatus = 'queued' | 'running' | 'waiting_quota' | 'awaiting_user' | 'failed' | 'closed';
export type TurnStatus = 'queued' | 'running' | 'done' | 'failed';
export type RunStatus = 'running' | 'completed' | 'quota_exhausted' | 'failed' | 'interrupted';
export type EventType =
  | 'TASK_CREATED' | 'TURN_STARTED' | 'TURN_FINISHED' | 'STATE_CHANGED'
  | 'RUN_STARTED' | 'RUN_FINISHED' | 'RUN_ERROR'
  | 'TEXT_MESSAGE_START' | 'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START' | 'TOOL_CALL_ARGS' | 'TOOL_CALL_END' | 'TOOL_CALL_RESULT'
  | 'QUOTA_UPDATED' | 'QUOTA_EXHAUSTED' | 'HANDOFF' | 'FILE_CHANGED' | 'USAGE';
export interface VEvent { id: number; taskId: string; runId: string | null; ts: number;
  source: 'managed' | 'observed'; type: EventType; data: Record<string, unknown> }
export interface Task { id: string; seq: number; title: string; repoPath: string;
  workspacePath: string | null; branch: string | null; baseCommit: string | null;
  mode: WorkspaceMode; priority: ProviderId[] | null; status: TaskStatus;
  currentProvider: ProviderId | null; createdAt: number; updatedAt: number }
export interface Turn { id: string; taskId: string; index: number; message: string;
  status: TurnStatus; runId: string | null; answer: string | null; attempts: number }
export interface Run { id: string; taskId: string; provider: ProviderId; sessionId: string | null;
  status: RunStatus; handoff: string | null; startedAt: number; endedAt: number | null }
export interface ProviderState { id: ProviderId; cooldownUntil: number | null;
  usedPercent: number | null; installed: boolean; version: string | null; updatedAt: number }
export interface Config { dataDir: string; port: number; priority: ProviderId[];
  concurrency: { perProvider: number; total: number }; quotaThreshold: number;
  defaultCooldownMs: number; turnTimeoutMs: number; network: boolean;
  defaultMode: WorkspaceMode; handoffMaxChars: number }
export const TASK_STATUS_LABEL: Record<TaskStatus, string>;
```

- [ ] **Step 1: Tạo workspace pnpm.**
  - Root `package.json`: `"private": true`, `"packageManager": "pnpm@9.15.0"`, `"engines": {"node": ">=22.13"}`, có các script `"test": "vitest run"`, `"build": "pnpm -r build"`, `"typecheck": "pnpm -r typecheck"`.
  - `pnpm-workspace.yaml`: `packages: ["packages/*"]`.
  - `tsconfig.base.json`: `strict`, `module`/`moduleResolution` đặt `NodeNext`, `target` `ES2023`.
  - `vitest.workspace.ts` liệt kê `packages/*`.
  - Mỗi package là ESM (`"type": "module"`), có script `build: tsc -p .` và `typecheck: tsc --noEmit -p .`.
- [ ] **Step 2: Viết test cho nhãn trạng thái.**

```ts
import { TASK_STATUS_LABEL } from '../src/index.js';
test('mỗi trạng thái task có nhãn tiếng Việt', () => {
  expect(TASK_STATUS_LABEL).toEqual({ queued: 'Chờ', running: 'Đang chạy', waiting_quota: 'Chờ quota',
    awaiting_user: 'Chờ bạn', failed: 'Lỗi', closed: 'Xong' });
});
```

- [ ] **Step 3: Chạy test và xác nhận nó fail.** Chạy `corepack pnpm install && corepack pnpm test`. Kết quả mong đợi: FAIL vì chưa có `TASK_STATUS_LABEL`.
- [ ] **Step 4: Viết các kiểu và `TASK_STATUS_LABEL`** ở `packages/shared/src/index.ts`, theo đúng khối Interfaces ở trên.
- [ ] **Step 5: Chạy lại và xác nhận pass.** Chạy `corepack pnpm test && corepack pnpm typecheck`. Kết quả mong đợi: PASS.
- [ ] **Step 6: Commit.** `git commit -m "chore: scaffold pnpm monorepo and shared types"`

---

### Task 2: Kho dữ liệu SQLite

**Files:**

- Create: `packages/core/package.json` (phụ thuộc `@voragent/shared`), `packages/core/src/store.ts`, `packages/core/src/bus.ts`
- Test: `packages/core/test/store.test.ts`

**Interfaces:**

- Consumes: các kiểu từ Task 1.
- Produces:

```ts
export interface NewTask { title: string; repoPath: string; mode: WorkspaceMode; priority: ProviderId[] | null; message: string }
export interface Store {
  createTask(t: NewTask): { task: Task; turn: Turn };       // tạo task kèm lượt 0, status 'queued'
  getTask(id: string): Task | null;
  listTasks(): Task[];                                       // mới nhất trước
  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'seq' | 'createdAt'>>): Task;
  addTurn(taskId: string, message: string): Turn;           // index = số lượt hiện có
  turnsOf(taskId: string): Turn[];
  queuedTurns(): Turn[];                                      // status 'queued', theo thời gian tạo
  updateTurn(id: string, patch: Partial<Omit<Turn, 'id' | 'taskId' | 'index'>>): Turn;
  createRun(r: { taskId: string; provider: ProviderId; handoff: string | null }): Run;
  runsOf(taskId: string): Run[];
  runningRuns(): Run[];
  updateRun(id: string, patch: Partial<Omit<Run, 'id' | 'taskId'>>): Run;
  appendEvent(e: Omit<VEvent, 'id' | 'ts'> & { ts?: number }): VEvent;
  eventsOf(taskId: string, afterId?: number): VEvent[];
  getProvider(id: ProviderId): ProviderState | null;
  upsertProvider(p: ProviderState): void;
  listProviders(): ProviderState[];
  close(): void;
}
export function openStore(file: string): Store;             // ':memory:' được chấp nhận
export class EventBus { publish(e: VEvent): void; subscribe(fn: (e: VEvent) => void): () => void }
```

- [ ] **Step 1: Viết các test sau.**
  - `createTask` trả về task có `seq` bắt đầu từ 1, `status: 'queued'`, và `turn.index === 0`.
  - `addTurn` lần thứ hai cho `index === 1`.
  - `appendEvent` gán `id` tăng dần, và `eventsOf(taskId, 1)` chỉ trả về các sự kiện có `id > 1`.
  - Mở lại cùng một file DB thì `getTask` vẫn đọc được task. Test này dùng file tạm trong `os.tmpdir()`.
  - `priority` lưu dưới dạng mảng và đọc ra vẫn là mảng.
- [ ] **Step 2: Chạy và xác nhận fail.** Chạy `corepack pnpm vitest run packages/core/test/store.test.ts`. Kết quả mong đợi: FAIL.
- [ ] **Step 3: Viết `openStore`** bằng `DatabaseSync` của `node:sqlite`.
  - Bật `PRAGMA journal_mode=WAL`. Lược đồ tạo bằng `CREATE TABLE IF NOT EXISTS` cho các bảng `tasks`, `turns`, `runs`, `events`, `providers`.
  - Trường JSON (`priority`, `data`) lưu dạng TEXT.
  - Id tạo bằng `crypto.randomUUID()`.
  - Viết `EventBus` bằng `EventEmitter`.
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): sqlite store and event bus"`

---

### Task 3: Giao kèo adapter, hàm dùng chung, CLI giả

**Files:**

- Create: `packages/adapters/package.json`, `packages/adapters/src/types.ts`, `packages/adapters/src/common.ts`, `packages/adapters/src/fake.ts`, `packages/adapters/test/fake-cli.mjs`
- Create fixtures: `packages/adapters/test/fixtures/fake-ok.jsonl`, `packages/adapters/test/fixtures/fake-quota.jsonl`
- Test: `packages/adapters/test/common.test.ts`, `packages/adapters/test/fake.test.ts`

**Interfaces:**

- Produces:

```ts
export interface TurnInput { prompt: string; systemPrompt: string; sessionId: string | null; cwd: string; network: boolean }
export interface Invocation { bin: string; args: string[]; stdin: string; env?: Record<string, string> }
export interface ParsedEvent { type: EventType; data: Record<string, unknown> }
export interface TurnResult {
  outcome: 'ok' | 'quota_exhausted' | 'error';
  text: string;                   // câu trả lời cuối của agent
  sessionId: string | null;
  resetsAt: number | null;        // epoch ms, chỉ có khi outcome là 'quota_exhausted'
  error: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  quota: { usedPercent: number; resetsAt: number | null } | null;   // khi CLI có báo
}
export interface StreamParser {
  push(line: string): ParsedEvent[];
  finish(exit: { code: number | null; stderr: string; timedOut: boolean }): TurnResult;
}
export interface Adapter {
  id: ProviderId;
  detect(): Promise<{ installed: boolean; version: string | null }>;
  invocation(input: TurnInput): Invocation;
  createParser(): StreamParser;
}
// common.ts
export function parseResetTime(text: string, now: number): number | null;
export function truncate(text: string, max: number, mark?: string): string;   // giữ phần cuối
// fake.ts
export function createFakeAdapter(opts: { id: ProviderId; fixture: string; exitCode?: number;
  touch?: string /* tên file sẽ ghi vào cwd */ }): Adapter;
```

Lưu ý cho `parseResetTime`:

- Hàm nhận được ba dạng:
  - epoch giây sau dấu `|`, ví dụ `"Claude AI usage limit reached|1762250400"`;
  - giờ dạng `resets 3pm`, `resets 3:45 PM`, `try again at 3:45 PM`;
  - thời lượng dạng `in 2 hours`, `in 45 minutes`.
- Giờ không kèm ngày được hiểu là lần gặp giờ đó **tiếp theo** sau `now`, theo giờ địa phương.
- Không đọc được thì trả `null`.

CLI giả `fake-cli.mjs <fixture> [--exit N] [--touch name]`:

- đọc hết stdin, rồi ghi stdin đó vào `<cwd>/.fake-stdin.txt`;
- nối thêm mảng đối số của lần gọi này (dạng một dòng JSON) vào `<cwd>/.fake-calls.jsonl`, để test đếm được số lần gọi và kiểm tra id phiên;
- nhận thêm tùy chọn `--session <id>`, nếu có thì in ra một dòng `{"type":"session","id":<id>}`. Adapter giả đưa `sessionId` vào đối số này khi tiếp tục phiên;
- in từng dòng của fixture ra stdout;
- nếu có `--touch` thì ghi file `<cwd>/<name>` với nội dung `edited by fake`;
- thoát với mã N.

Fixture giả dùng cùng định dạng với stream-json của Claude, để `fake.ts` dùng lại parser của Claude (Task 4). Trong task này, `fake.ts` tạm dùng một parser tối thiểu: dòng `{"type":"text","text":…}`, `{"type":"session","id":…}`, và `{"type":"quota","resetsAt":…}` cho trường hợp hết quota.

- [ ] **Step 1: Viết test cho `parseResetTime`.**
  - Với `now = new Date(2026,10,4,10,0).getTime()`:
    - `"…|1762250400"` cho `1762250400000`;
    - `"resets 3pm"` cho 15:00 cùng ngày;
    - `"try again at 9:30 AM"` cho 09:30 **ngày hôm sau**;
    - `"in 2 hours"` cho `now + 7_200_000`;
    - `"no time here"` cho `null`.
  - `truncate('abcdef', 4)` cho `'…def'`.
- [ ] **Step 2: Viết test cho adapter giả.**
  - Chạy `invocation()` qua `child_process.spawnSync` với `fake-ok.jsonl`. Parser trả về `outcome: 'ok'`, `text: 'xong'`, `sessionId: 'fake-s1'`.
  - Với `fake-quota.jsonl` và `--exit 1`, parser trả về `outcome: 'quota_exhausted'` và `resetsAt` lấy từ fixture.
- [ ] **Step 3: Chạy và xác nhận fail.**
- [ ] **Step 4: Viết `common.ts`, `fake.ts`, `fake-cli.mjs` và hai fixture.**
  - `invocation()` của adapter giả trả về `{ bin: process.execPath, args: [fakeCliPath, fixture, ...], stdin: systemPrompt + '\n\n' + prompt }`.
- [ ] **Step 5: Chạy lại và xác nhận pass.**
- [ ] **Step 6: Commit.** `git commit -m "feat(adapters): adapter contract, reset-time parsing, fake CLI"`

---

### Task 4: Adapter Claude Code

**Files:**

- Create: `packages/adapters/src/claude.ts`
- Create fixtures: `packages/adapters/test/fixtures/claude-ok.jsonl`, `claude-tools.jsonl`, `claude-quota.jsonl`, `claude-mentions-limit.jsonl`
- Test: `packages/adapters/test/claude.test.ts`

**Interfaces:**

- Consumes: `Adapter`, `StreamParser`, `parseResetTime` từ Task 3.
- Produces: `export function createClaudeAdapter(): Adapter` với `id: 'claude'`.

Lệnh chạy:

```text
bin: 'claude'
args: ['-p', ...(sessionId ? ['--resume', sessionId] : []), '--output-format', 'stream-json',
       '--include-partial-messages', '--verbose', '--permission-mode', 'auto',
       ...(systemPrompt ? ['--append-system-prompt', systemPrompt] : [])]
stdin: prompt
```

Ánh xạ stream sang sự kiện. Cách đọc giống `AnswerStream` trong `tiptask/packages/runner/src/agui.ts`:

- `session_id` có trên mọi dòng. Lấy giá trị ở dòng đầu tiên.
- `stream_event` có `content_block_delta.text_delta` cho ra `TEXT_MESSAGE_CONTENT`.
- `assistant` có khối `tool_use` cho ra `TOOL_CALL_START` (kèm tên) và `TOOL_CALL_ARGS`.
- `user` có khối `tool_result` cho ra `TOOL_CALL_RESULT`.
- Nếu tên tool là `Edit` / `Write` / `MultiEdit` / `NotebookEdit` thì phát thêm `FILE_CHANGED {path}`.
- `result` cho ra `text` cuối và `USAGE`.

Nhận diện hết quota. **Chỉ** xét một trong ba nguồn sau, không xét chữ trong câu trả lời:

1. dòng `result` có `is_error: true`;
2. stderr;
3. mã thoát khác 0.

Nội dung ở các nguồn đó khớp một trong các mẫu `/usage limit reached/i`, `/\b(5-hour|weekly|session|opus) limit\b/i`, `/out of (extra )?usage/i` thì coi là hết quota. `resetsAt` lấy bằng `parseResetTime`.

- [ ] **Step 1: Thu output thật cho fixture.** Trên máy đã cài Claude Code 2.1.x:
  - chạy `echo "trả lời đúng một chữ: xong" | claude -p --output-format stream-json --include-partial-messages --verbose`, lưu vào `claude-ok.jsonl`;
  - chạy với yêu cầu "đọc file package.json rồi trả lời tên package", lưu vào `claude-tools.jsonl`.
  - Thông báo hết quota: tìm trong `~/.claude/projects/**/*.jsonl` (`grep -ril "limit reached"`). Nếu không có, dựng `claude-quota.jsonl` từ `claude-ok.jsonl`, thay dòng `result` bằng `{"type":"result","subtype":"success","is_error":true,"result":"Claude AI usage limit reached|1762250400","session_id":"…"}`. Ghi rõ trong `test/fixtures/README.md` là fixture dựng tay, cần thay bằng bản thật khi gặp. Ghi cả phiên bản CLI đã dùng.
  - `claude-mentions-limit.jsonl`: bản sao `claude-ok.jsonl` có câu trả lời chứa "usage limit reached", nhưng `is_error: false` và mã thoát 0.
- [ ] **Step 2: Viết test.** Đẩy từng dòng fixture qua parser, sau đó gọi `finish`.
  - `claude-ok`: `outcome 'ok'`, `text` chứa "xong", `sessionId` khớp `session_id` trong fixture.
  - `claude-tools`: có ít nhất một `TOOL_CALL_START` với `toolCallName === 'Read'`, và có `TOOL_CALL_RESULT` tương ứng.
  - `claude-quota` với `code: 1`: `outcome 'quota_exhausted'`, `resetsAt === 1762250400000`.
  - `claude-mentions-limit` với `code: 0`: `outcome 'ok'`. Đây là mục 1 của phần lỗi dễ gặp.
  - Stderr `"Error: connect ECONNREFUSED"` với `code: 1`: `outcome 'error'`, `error` chứa `ECONNREFUSED`.
  - `invocation({sessionId:'s1', systemPrompt:'SP', …})` có `args` chứa `['--resume','s1']` và `['--append-system-prompt','SP']`, `stdin === prompt`.
- [ ] **Step 3: Chạy và xác nhận fail.**
- [ ] **Step 4: Viết `createClaudeAdapter`.** `detect()` chạy `claude --version` qua `cross-spawn` và lấy số phiên bản.
- [ ] **Step 5: Chạy lại và xác nhận pass.**
- [ ] **Step 6: Commit.** `git commit -m "feat(adapters): claude code adapter with quota detection"`

---

### Task 5: Adapter Codex

**Files:**

- Create: `packages/adapters/src/codex.ts`, `packages/adapters/src/index.ts`
- Create fixtures: `codex-ok.jsonl`, `codex-tools.jsonl`, `codex-quota.jsonl`, `codex-mentions-limit.jsonl`
- Test: `packages/adapters/test/codex.test.ts`

**Interfaces:**

- Produces:
  - `export function createCodexAdapter(): Adapter` với `id: 'codex'`;
  - `export function createAdapters(ids: ProviderId[]): Map<ProviderId, Adapter>`. Id không biết thì bỏ qua.

Lệnh chạy:

```text
bin: 'codex'
args: [...(sessionId ? ['exec','resume',sessionId] : ['exec']), '--json',
       '-c', 'sandbox_mode="workspace-write"',
       ...(network ? ['-c','sandbox_workspace_write.network_access=true'] : []), '-']
stdin: systemPrompt ? systemPrompt + '\n\n' + prompt : prompt
```

Ánh xạ stream sang sự kiện, giống phần Codex trong `agui.ts` của runner:

- `thread.started.thread_id` là `sessionId`.
- `item.completed` loại `agent_message` là đoạn văn bản.
- `item.started` / `item.completed` loại `command_execution`, `mcp_tool_call`, `file_change`, `web_search` là gọi tool. `command_execution` mang tên `shell`.
- `file_change` phát thêm `FILE_CHANGED`.
- `turn.completed.usage` cho ra `USAGE`.
- Sự kiện nào có trường `rate_limits` (kiểu `{primary:{used_percent, resets_in_seconds}}`) thì cho ra `quota`: `usedPercent = used_percent/100`, `resetsAt = now + resets_in_seconds*1000`.

Nhận diện hết quota chỉ xét sự kiện `error` / `turn.failed`, stderr hoặc mã thoát khác 0. Nội dung khớp `/usage limit/i`, `/hit your usage limit/i` hoặc `/quota exceeded/i` thì coi là hết quota.

- [ ] **Step 1: Thu fixture.** Codex chưa được cài trên máy dev hiện tại. Cài bằng `npm i -g @openai/codex` và đăng nhập, rồi thu `codex-ok` và `codex-tools` giống Task 4. Nếu không cài được, dựng fixture theo định dạng trong `agui.ts` của runner và ghi rõ là dựng tay trong `fixtures/README.md`. `codex-quota.jsonl` kết thúc bằng `{"type":"error","message":"You've hit your usage limit. Try again at 3:45 PM."}`.
- [ ] **Step 2: Viết test**, cùng bộ khung với Task 4:
  - ok;
  - tools, có `TOOL_CALL_START` với `toolCallName === 'shell'`;
  - quota, `resetsAt` là 15:45 tiếp theo sau `now` cố định trong test;
  - mentions-limit cho `ok`;
  - stderr lỗi mạng cho `error`;
  - `invocation` có `exec resume s1` khi có phiên, có `network_access=true` khi `network: true`;
  - `createAdapters(['claude','codex','x']).size === 2`.
- [ ] **Step 3: Chạy và xác nhận fail.**
- [ ] **Step 4: Viết `createCodexAdapter` và `createAdapters`.**
- [ ] **Step 5: Chạy lại và xác nhận pass.**
- [ ] **Step 6: Commit.** `git commit -m "feat(adapters): codex adapter and registry"`

---

### Task 6: Chạy một lượt CLI

**Files:**

- Create: `packages/core/src/proc.ts`
- Test: `packages/core/test/proc.test.ts`

**Interfaces:**

- Consumes: `Adapter`, `TurnInput`, `ParsedEvent`, `TurnResult` (Task 3); `createFakeAdapter` (Task 3).
- Produces:

```ts
export function runTurn(adapter: Adapter, input: TurnInput, opts: {
  timeoutMs: number; signal?: AbortSignal; onEvent: (e: ParsedEvent) => void;
}): Promise<TurnResult>;
```

Cách làm:

- Gọi `cross-spawn(inv.bin, inv.args, { cwd: input.cwd, env: {...process.env, ...inv.env} })`. Ghi `inv.stdin` vào stdin rồi đóng.
- Tách stdout thành từng dòng (giữ lại phần dòng còn dở), đưa qua `parser.push`, gửi từng sự kiện qua `onEvent`.
- Stderr giữ lại 4000 ký tự cuối.
- Hết thời gian chờ hoặc nhận `abort` thì dừng cả cây tiến trình: trên Windows chạy `taskkill /pid <pid> /T /F`, trên POSIX spawn với `detached: true` rồi `process.kill(-pid, 'SIGKILL')`. Sau đó gọi `finish({timedOut: true, …})`.
- Lỗi `ENOENT` khi spawn (CLI chưa cài) cho `outcome: 'error'`, `error: 'Không tìm thấy lệnh <bin>'`.

- [ ] **Step 1: Viết test.** Dùng adapter giả và cwd tạm.
  - Fixture ok cho `outcome: 'ok'`, và `onEvent` nhận ít nhất một `TEXT_MESSAGE_CONTENT`.
  - Prompt `'Dòng 1 "trích dẫn"\nDòng 2 — tiếng Việt có dấu'` thì `.fake-stdin.txt` trong cwd chứa nguyên văn chuỗi đó. Đây là mục 5 của phần lỗi dễ gặp. Trên Windows, test này còn chạy thêm với một shim `.cmd` (`fake.cmd` gọi `node fake-cli.mjs %*`), tạo tạm trong cwd.
  - `timeoutMs: 200` với fixture có dòng `{"type":"sleep","ms":5000}` (CLI giả phải hỗ trợ dòng này) thì kết quả trả về trong vòng 2 giây, có `outcome: 'error'`.
  - `bin: 'khong-ton-tai-xyz'` cho `outcome: 'error'`, `error` chứa `khong-ton-tai-xyz`.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `runTurn`.** Thêm hỗ trợ dòng `sleep` vào `fake-cli.mjs`.
- [ ] **Step 4: Chạy lại và xác nhận pass,** trên Windows và nếu có thể thì trên cả POSIX.
- [ ] **Step 5: Commit.** `git commit -m "feat(core): run one CLI turn with streaming, timeout, tree kill"`

---

### Task 7: Worktree

**Files:**

- Create: `packages/core/src/workspace.ts`
- Test: `packages/core/test/workspace.test.ts`

**Interfaces:**

- Produces:

```ts
export interface Workspace { path: string; branch: string | null; baseCommit: string | null; isolated: boolean }
export function createWorkspace(o: { repoPath: string; worktreesDir: string; taskSeq: number; mode: WorkspaceMode }): Promise<Workspace>;
export function commitAll(ws: Workspace, message: string): Promise<string | null>;   // trả về sha, hoặc null khi không có gì để commit
export function workspaceSummary(ws: Workspace): Promise<{ status: string; diff: string; commits: string[] }>; // diff so với baseCommit
```

Cách làm:

- `repoPath` không phải repo git (`git rev-parse` thất bại) thì trả `{path: repoPath, branch: null, baseCommit: null, isolated: false}`.
- Còn lại: `baseCommit = git rev-parse HEAD`, chạy `git worktree add -b voragent/task-<seq> <worktreesDir>/task-<seq> HEAD`.
- Chế độ có `dirty`:
  - chạy `git diff HEAD --binary` trong repo gốc, rồi `git apply --binary` trong worktree;
  - chép các file trong `git ls-files --others --exclude-standard` (giữ nguyên đường dẫn tương đối);
  - các file bị xóa đã nằm sẵn trong diff.
- Chế độ `head-dirty-commit`: commit trạng thái mang sang với thông điệp `voragent: mang theo thay đổi chưa commit`, để diff của agent tách biệt với việc dở.
- `workspaceSummary` trả về `git status --short`, `git diff <baseCommit>` (kèm file chưa được theo dõi, dùng `git add -N` trước), và `git log --format=%h %s <baseCommit>..HEAD`.
- Mọi lệnh git chạy qua `cross-spawn` với `cwd`. Không dùng shell.

- [ ] **Step 1: Viết test** trên một repo tạm: tạo bằng `git init`, có `a.txt` đã commit, `b.bin` nhị phân đã commit.
  - Repo có việc dở: sửa `a.txt`, thêm `new.txt` chưa được theo dõi, xóa `b.bin`. `createWorkspace(mode 'head-dirty-commit')` cho ra worktree có `a.txt` đã sửa, có `new.txt`, không có `b.bin`.
  - Sau đó, `git status --short` của repo **gốc** giống hệt trước khi gọi. Đây là mục 2 của phần lỗi dễ gặp.
  - `mode 'head-commit'` cho ra worktree có `a.txt` bản đã commit, không có `new.txt`.
  - `branch === 'voragent/task-7'` khi `taskSeq: 7`.
  - Ghi file trong worktree rồi `commitAll` thì trả về sha. Gọi lại ngay thì trả `null`.
  - `workspaceSummary` sau khi sửa có `diff` chứa tên file đã sửa.
  - Thư mục không phải git cho `isolated === false` và `path === repoPath`.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `workspace.ts`.**
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): git worktrees with three modes"`

---

### Task 8: Cấu hình và chọn nền tảng

**Files:**

- Create: `packages/core/src/config.ts`, `packages/core/src/scheduler.ts`
- Test: `packages/core/test/config.test.ts`, `packages/core/test/scheduler.test.ts`

**Interfaces:**

- Produces:

```ts
export const DEFAULT_CONFIG: Omit<Config, 'dataDir'>;   // các giá trị ở phần Ràng buộc chung
export function loadConfig(dataDir: string): Config;     // gộp dataDir/config.json vào mặc định; thiếu file thì dùng mặc định
export function pickProvider(o: {
  priority: ProviderId[]; current: ProviderId | null; isNewTask: boolean;
  providers: Map<ProviderId, ProviderState>; running: Map<ProviderId, number>; totalRunning: number;
  config: Config; now: number;
}): { provider: ProviderId } | { wait: 'quota' | 'capacity' };
```

Quy tắc của `pickProvider`, xét theo thứ tự:

1. `totalRunning >= config.concurrency.total` thì trả `{wait: 'capacity'}`.
2. Có `current` và nền tảng đó dùng được thì trả `current`. Dùng được nghĩa là đã cài, không trong thời gian tạm nghỉ (`cooldownUntil` bằng null hoặc nhỏ hơn hoặc bằng `now`), và chưa đầy `perProvider`.
3. Duyệt `priority`, lấy nền tảng đầu tiên dùng được. Nếu `isNewTask`, bỏ qua thêm các nền tảng có `usedPercent >= quotaThreshold`.
4. Không có nền tảng nào: nếu có ít nhất một nền tảng chỉ vướng giới hạn song song thì trả `{wait: 'capacity'}`, còn lại trả `{wait: 'quota'}`.

- [ ] **Step 1: Viết test.**
  - `loadConfig` với thư mục rỗng cho ra `priority ['claude','codex']`, `quotaThreshold 0.9`, `port 4717`.
  - File `config.json` ghi `{"priority":["codex"]}` thì ghi đè `priority` nhưng giữ các mặc định khác.
  - Có `current` là `'claude'` đang dùng được thì trả `claude`, dù `codex` đứng trước trong danh sách ưu tiên.
  - `claude` có `cooldownUntil = now + 1000` thì trả `codex`. Khi `now` đi qua thời điểm đó thì trả `claude`.
  - Việc mới, `claude.usedPercent = 0.95` thì trả `codex`. Việc cũ có `current` là claude với cùng `usedPercent` thì vẫn trả `claude`.
  - Cả hai đều tạm nghỉ thì trả `{wait:'quota'}`. `totalRunning = 4` thì trả `{wait:'capacity'}`.
  - Nền tảng `installed: false` không bao giờ được chọn.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `config.ts` và `scheduler.ts`.**
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): config defaults and provider selection"`

---

### Task 9: Bản bàn giao

**Files:**

- Create: `packages/core/src/handoff.ts`
- Test: `packages/core/test/handoff.test.ts`

**Interfaces:**

- Produces:

```ts
export function buildHandoff(o: {
  task: Task; turns: Turn[]; events: VEvent[]; fromProvider: ProviderId; reason: 'quota' | 'interrupted';
  summary: { status: string; diff: string; commits: string[] }; maxChars: number;
}): string;
```

Nội dung, theo thứ tự, mỗi phần có tiêu đề Markdown:

1. `# Bàn giao từ <fromProvider>`, kèm lý do: hết quota, hoặc daemon bị ngắt.
2. `## Yêu cầu gốc`: tin nhắn của lượt 0.
3. `## Các lượt trước`: mỗi lượt đã xong ghi `Người dùng:` cùng tin nhắn, `Agent:` cùng 500 ký tự cuối của câu trả lời.
4. `## Những gì đã làm`: mỗi `TOOL_CALL_START` một dòng `- <tên tool> <tóm tắt đối số, tối đa 120 ký tự>`, giữ tối đa 60 dòng cuối, và đếm số file trong các `FILE_CHANGED`.
5. `## Câu trả lời cuối của agent trước`: 1500 ký tự cuối của văn bản trong run gần nhất.
6. `## Trạng thái git`: status, các commit, rồi diff.
7. Câu dặn cố định: `Tiếp tục công việc từ đây. Kiểm tra lại trạng thái file trước khi sửa thêm.`

Khi bản bàn giao dài quá `maxChars`, rút gọn diff trước, giữ phần cuối bằng `truncate`. Chưa đủ thì rút gọn tiếp mục 4. Các mục còn lại không bị cắt.

- [ ] **Step 1: Viết test.**
  - Bản bàn giao có đủ 7 phần theo đúng thứ tự (kiểm tra vị trí các tiêu đề).
  - Chứa nguyên văn tin nhắn lượt 0 và câu dặn cố định.
  - Diff dài 100 000 ký tự với `maxChars: 24000` cho kết quả dài tối đa 24 000 ký tự, vẫn chứa yêu cầu gốc và câu dặn.
  - `reason: 'interrupted'` thì có chữ "daemon bị ngắt".
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `buildHandoff`.**
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): handoff composer"`

---

### Task 10: Bộ điều phối

**Files:**

- Create: `packages/core/src/orchestrator.ts`
- Test: `packages/core/test/orchestrator.test.ts`

**Interfaces:**

- Consumes: `Store`, `EventBus` (Task 2); `Adapter` (Task 3); `runTurn` (Task 6); `createWorkspace`, `commitAll`, `workspaceSummary` (Task 7); `pickProvider`, `Config` (Task 8); `buildHandoff` (Task 9).
- Produces:

```ts
export interface Orchestrator {
  submitTask(i: { repoPath: string; message: string; title?: string; mode?: WorkspaceMode; priority?: ProviderId[] }): Promise<Task>;
  sendMessage(taskId: string, message: string): Turn;    // chỉ khi status 'awaiting_user' hoặc 'failed'
  closeTask(taskId: string): void;
  retry(taskId: string, o?: { switchProvider?: boolean }): void;
  tick(): Promise<void>;          // khởi động các lượt đủ điều kiện; không chờ chúng chạy xong
  idle(): Promise<void>;          // chờ mọi lượt đang chạy xong (dùng trong test)
  recover(): void;                // gọi một lần lúc khởi động
  refreshProviders(): Promise<void>;   // gọi detect() rồi cập nhật installed/version
  start(intervalMs?: number): void; stop(): Promise<void>;
}
export function createOrchestrator(d: { store: Store; bus: EventBus; adapters: Map<ProviderId, Adapter>;
  config: Config; now?: () => number }): Orchestrator;
```

Luồng xử lý một lượt trong `tick()`:

1. Lấy các `queuedTurns()` lần lượt. Bỏ qua task đã có lượt đang chạy.
2. Gọi `pickProvider`, với `isNewTask` là "task chưa có run nào".
   - Nếu phải chờ quota, task chuyển sang `waiting_quota`.
   - Nếu phải chờ vì đầy song song, giữ nguyên trạng thái `queued`.
3. Task chưa có workspace thì gọi `createWorkspace` và lưu `workspacePath`, `branch`, `baseCommit`.
4. Chọn run:
   - Run gần nhất của task, cùng nền tảng, đang ở `completed` thì dùng lại: chuyển nó về `running` và tiếp tục phiên bằng `sessionId`. Run chỉ ở `running` trong lúc một lượt đang chạy, nên `recover()` không đụng tới các run đang nghỉ giữa hai lượt.
   - Còn lại thì tạo run mới. Nếu task đã có run trước đó, run mới mang `handoff = buildHandoff(...)` với `reason` là `'quota'` hoặc `'interrupted'`, tùy trạng thái run trước. Sau đó phát sự kiện `HANDOFF {from, to}`.
5. Prompt: run mới có bản bàn giao thì gửi `handoff + '\n\n## Tin nhắn hiện tại của người dùng\n' + turn.message`, còn lại chỉ gửi `turn.message`. `systemPrompt` cố định: `Bạn đang làm việc trong thư mục <workspacePath>. Chỉ sửa file trong thư mục này.`
6. Cập nhật trạng thái: lượt thành `running`, task thành `running`, phát `TURN_STARTED` và `STATE_CHANGED`. Rồi gọi `runTurn`. Mỗi `ParsedEvent` được ghi bằng `store.appendEvent` và `bus.publish`.
7. Xử lý kết quả:
   - **`ok`:**
     - Lưu `sessionId`.
     - Ở chế độ có commit, gọi `commitAll(ws, 'voragent: lượt <index> (<provider>)')`.
     - Lượt thành `done` (lưu `answer`). Run thành `completed`. Task thành `awaiting_user`. Phát `TURN_FINISHED`.
     - Nếu có `quota` thì cập nhật `usedPercent` và phát `QUOTA_UPDATED`.
   - **`quota_exhausted`:**
     - Nền tảng nhận `cooldownUntil = resetsAt ?? now + defaultCooldownMs`.
     - Ở chế độ có commit, commit phần đang dở.
     - Run thành `quota_exhausted`. Phát `QUOTA_EXHAUSTED {provider, resetsAt}`.
     - Lượt quay về `queued`, `attempts` giữ nguyên. Task bỏ `currentProvider`.
     - Gọi `tick()` lại ngay.
   - **`error`:**
     - `attempts < 1`: tăng `attempts`, lượt quay về `queued`, giữ run và phiên.
     - Ngược lại: lượt thành `failed`, run thành `failed`, task thành `failed`, phát `RUN_ERROR {error}`.
8. Task đang `waiting_quota`: ở mỗi `tick()`, nếu `pickProvider` đã trả về một nền tảng thì task chuyển lại `queued` và chạy.

Các hàm khác:

- `recover()`: run nào còn `running` thì chuyển thành `interrupted`. Lượt `running` tương ứng quay về `queued`. Task tương ứng quay về `queued`. Mỗi lượt chỉ chạy lại **một lần**.
- `retry(taskId, {switchProvider})`: lượt `failed` cuối cùng quay về `queued` và `attempts` về 0. Nếu `switchProvider`, nền tảng hiện tại tạm nghỉ 0 ms, bỏ `currentProvider`, và run kế tiếp mang bản bàn giao.
- `closeTask`: task thành `closed`. Worktree được giữ lại.

- [ ] **Step 1: Viết test.** Mỗi test dùng một repo git tạm, store `:memory:`, và các adapter giả.
  - **G1, chuyển nền tảng:**
    - Setup: `fake-a` dùng `fake-quota.jsonl` với `--exit 1` và `--touch a.txt`. `fake-b` dùng `fake-ok.jsonl` với `--touch b.txt`. `priority ['fake-a','fake-b']`.
    - Gọi `submitTask`, rồi `tick()` và `idle()`, lặp đến khi task ở trạng thái `awaiting_user`.
    - Kiểm tra:
      - có 2 run (`fake-a` `quota_exhausted`, `fake-b` `completed`), cả hai chạy trong cùng một `workspacePath`;
      - có sự kiện `HANDOFF {from:'fake-a', to:'fake-b'}`;
      - worktree có cả `a.txt` lẫn `b.txt`;
      - `.fake-stdin.txt` của lần chạy `fake-b` chứa `# Bàn giao từ fake-a` và tin nhắn gốc;
      - `fake-a` có `cooldownUntil` khớp với `resetsAt` trong fixture;
      - `git log` của nhánh có commit `voragent: lượt 0 (fake-b)`.
  - **Mọi nền tảng tạm nghỉ** (mục 4 của phần lỗi dễ gặp):
    - Setup: chỉ có `fake-a` (dùng fixture hết quota), và `now()` giả.
    - Sau lần chạy đầu, task ở `waiting_quota`, status không phải `failed`.
    - Thay `fake-a` trong Map adapter bằng một adapter giả mới dùng fixture ok, cho `now()` vượt `cooldownUntil`, gọi `tick()` rồi `idle()`. Task thành `awaiting_user`.
  - **Bị ngắt giữa chừng** (mục 3 của phần lỗi dễ gặp):
    - Setup: ghi trực tiếp vào store một run `running` và một lượt `running`.
    - Gọi `recover()`, rồi `tick()` và `idle()`.
    - Đúng một run mới được tạo, mang bản bàn giao có chữ "daemon bị ngắt". Lượt kết thúc `done`, `queuedTurns()` rỗng.
  - **Lỗi thường:**
    - Setup: `fake-a` thoát mã 1, stderr `boom`, không có mẫu quota.
    - `.fake-calls.jsonl` có đúng 2 dòng, sau đó task thành `failed`.
    - Gọi `retry(id, {switchProvider:true})` với có `fake-b`. Run mới là `fake-b` và mang bản bàn giao.
  - **Trò chuyện:**
    - Sau lượt 0 `done`, `sendMessage(id,'tiếp')` thì lượt 1 chạy trên cùng run. Dòng cuối của `.fake-calls.jsonl` chứa `--session fake-s1`.
    - `sendMessage` khi task đang `running` thì ném lỗi.
  - **Chế độ `dirty-nocommit`:** sau khi xong, `git log baseCommit..HEAD` rỗng nhưng `git status` có `b.txt`.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `createOrchestrator`.** `start()` gọi `tick()` mỗi 2000 ms và gọi `refreshProviders()` lúc khởi động.
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat(core): orchestrator with quota handoff, retry and recovery"`

---

### Task 11: Daemon, HTTP/WebSocket và lệnh `voragent`

**Files:**

- Create: `packages/core/src/server.ts`, `packages/core/src/daemon.ts`, `packages/core/src/index.ts`
- Create: `packages/cli/package.json` (`"bin": {"voragent": "dist/main.js"}`), `packages/cli/src/main.ts`
- Create: `README.md`
- Test: `packages/core/test/server.test.ts`, `packages/cli/test/main.test.ts`

**Interfaces:**

- Consumes: `Orchestrator` (Task 10), `Store`, `EventBus`, `loadConfig`, `createAdapters`.
- Produces:

```ts
export function createServer(d: { orchestrator: Orchestrator; store: Store; bus: EventBus; key: string; webDir: string | null }): Hono;
export function startDaemon(o: { dataDir: string; port?: number; adapters?: Map<ProviderId, Adapter> }):
  Promise<{ url: string; key: string; port: number; stop(): Promise<void> }>;   // ghi dataDir/daemon.json {port,key,pid}
```

API (mọi route nằm dưới `/api`, thiếu khóa thì trả 401):

| Method | Path | Body | Trả về |
| --- | --- | --- | --- |
| GET | `/api/tasks` | | `Task[]` |
| POST | `/api/tasks` | `{repoPath, message, title?, mode?, priority?}` | `Task` (201) |
| GET | `/api/tasks/:id` | | `{task, turns, runs, events}` |
| POST | `/api/tasks/:id/messages` | `{message}` | `Turn` (201). Trả 409 khi task không nhận tin nhắn |
| POST | `/api/tasks/:id/close` | | 204 |
| POST | `/api/tasks/:id/retry` | `{switchProvider?}` | 204 |
| GET | `/api/tasks/:id/diff` | | `{status, diff, commits}` |
| GET | `/api/providers` | | `ProviderState[]` |
| GET | `/api/config` | | `Config` |
| WS | `/api/events?key=` | | mỗi `VEvent` là một tin nhắn JSON. Tin nhắn đầu tiên là `{type:'HELLO'}` |

- Request `GET /?key=…` đặt cookie `voragent_key`, rồi phục vụ `webDir`. `webDir` lấy từ `packages/web/dist`, tìm bằng `import.meta.url`. Không có thư mục đó thì trả trang báo "chưa build web".

Lệnh `voragent`, viết bằng `node:util` `parseArgs`:

- `voragent [--port N] [--no-open]`: chạy daemon ngay trong terminal, in URL đầy đủ kèm khóa, và mở trình duyệt (dùng `start` / `open` / `xdg-open` qua `cross-spawn`). Nhấn Ctrl-C thì dừng daemon có trật tự.
- `voragent start --background`: spawn chính nó ở chế độ `detached`, ghi stdout và stderr vào `daemon.log`, in URL rồi thoát.
- `voragent add <repoPath> <message…> [--mode m] [--agent id]`: đọc `daemon.json`, gọi `POST /api/tasks`, in số thứ tự task. Daemon chưa chạy thì in `Daemon chưa chạy. Chạy: voragent`, thoát mã 1.
- `voragent status`: in bảng các nền tảng (đã cài hay chưa, tạm nghỉ đến lúc nào) và các task chưa đóng.
- `voragent stop`: gửi `POST /api/shutdown` (route này cũng cần khóa).

Cách làm thêm:

- `startDaemon` lần lượt: mở store, gọi `recover()`, `refreshProviders()`, `start()`, rồi `serve` (`@hono/node-server`, `hostname: '127.0.0.1'`).
- Gắn WebSocket server `ws` vào cùng HTTP server.
- Khóa là `randomBytes(24).toString('hex')`.

- [ ] **Step 1: Viết test.**
  - Không có khóa thì `GET /api/tasks` trả 401. Có khóa thì trả 200 kèm mảng.
  - `POST /api/tasks` với adapter giả trả 201.
  - Mở WebSocket và nhận lần lượt `HELLO`, `TASK_CREATED`, `TURN_STARTED`, rồi `TURN_FINISHED`.
  - `POST /messages` khi task đang `running` trả 409.
  - `startDaemon` ghi `daemon.json` có `port`, `key`, `pid`. Gọi `stop()` thì cổng được giải phóng.
  - `voragent add` khi không có `daemon.json` thì thoát mã 1 và in đúng thông báo.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết server, daemon và CLI.** README ghi cách cài, chạy, file cấu hình, và các lệnh.
- [ ] **Step 4: Chạy lại và xác nhận pass.**
- [ ] **Step 5: Commit.** `git commit -m "feat: daemon http/ws api and voragent cli"`

---

### Task 12: Web tối thiểu

**Files:**

- Create: `packages/web/package.json`, `packages/web/vite.config.ts`, `packages/web/index.html`
- Create: `packages/web/src/main.tsx`, `src/api.ts`, `src/state.ts`, `src/App.tsx`, `src/QuotaBar.tsx`, `src/Board.tsx`, `src/TaskView.tsx`, `src/NewTaskForm.tsx`, `src/styles.css`
- Test: `packages/web/test/state.test.ts`

**Interfaces:**

- Consumes: các kiểu từ `@voragent/shared`, API của Task 11.
- Produces (`src/state.ts`):

```ts
export type Column = 'Chờ' | 'Đang chạy' | 'Chờ bạn' | 'Xong' | 'Lỗi';
export function columnOf(status: TaskStatus): Column;   // queued và waiting_quota vào 'Chờ'
export interface UiState { tasks: Map<string, Task>; events: Map<string, VEvent[]>; providers: Map<ProviderId, ProviderState> }
export function applyEvent(s: UiState, e: VEvent): UiState;   // thuần; nối thêm event, cập nhật status của task khi gặp STATE_CHANGED {status}
export function transcript(events: VEvent[]): Array<{ kind: 'user' | 'agent' | 'tool' | 'handoff' | 'error'; text: string; ts: number }>;
```

Giao diện (giữ đơn giản, không cần đẹp, giai đoạn 2 mới làm văn phòng 3D):

- **Đầu trang:** `QuotaBar`, mỗi nền tảng một ô. Màu xanh là sẵn sàng. Màu vàng là đã dùng từ 90%. Màu đỏ là tạm nghỉ, kèm chữ `tạm nghỉ đến HH:mm`. Màu xám là chưa cài.
- **`Board`:** 5 cột theo `columnOf`. Thẻ hiện số thứ tự task, tiêu đề, nền tảng hiện tại, và số lần bàn giao (đếm sự kiện `HANDOFF`).
- **`TaskView`:** danh sách `transcript`. Lần bàn giao hiện thành một vạch ngang "🔁 chuyển từ A sang B". Bên dưới là diff (`GET /diff`), các nút **Gửi** (ô nhập tin nhắn), **Xong**, **Chạy lại**, **Chuyển nền tảng khác**.
- **`NewTaskForm`:** đường dẫn repo, tin nhắn, chế độ worktree (3 lựa chọn, mặc định `head-dirty-commit`, nhãn tiếng Việt như mục 6.2 của spec), nền tảng (tùy chọn).
- Mọi lần gọi API dùng cookie `voragent_key`. WebSocket dùng `?key=` đọc từ URL hoặc cookie. Mất kết nối thì tự kết nối lại sau 2 giây và tải lại `GET /api/tasks`.

- [ ] **Step 1: Viết test.**
  - `columnOf('waiting_quota') === 'Chờ'`, `columnOf('awaiting_user') === 'Chờ bạn'`.
  - `applyEvent` với `STATE_CHANGED {status:'failed'}` đổi status của task.
  - `transcript` với chuỗi sự kiện `TURN_STARTED{message}`, `TEXT_MESSAGE_CONTENT×2`, `TOOL_CALL_START{toolCallName:'Read'}`, `HANDOFF{from:'claude',to:'codex'}` trả về đúng thứ tự các `kind` `['user','agent','tool','handoff']`, và hai đoạn văn bản được gộp thành một.
- [ ] **Step 2: Chạy và xác nhận fail.**
- [ ] **Step 3: Viết `state.ts` và các component.** Script `build: vite build`, ra `packages/web/dist`.
- [ ] **Step 4: Chạy lại và xác nhận pass,** rồi chạy `corepack pnpm -r build`.
- [ ] **Step 5: Kiểm tra bằng tay với adapter giả.** Đặt `config.json` gồm `{"priority":["fake-a","fake-b"]}` và biến môi trường `VORAGENT_FAKE=1`. Khi có biến này, `startDaemon` thêm hai adapter giả như trong test G1. Chạy `voragent`, tạo task trên web. Thẻ phải đi qua các cột Chờ → Đang chạy → Chờ bạn, `TaskView` có vạch bàn giao, `QuotaBar` hiện `fake-a` tạm nghỉ.
- [ ] **Step 6: Commit.** `git commit -m "feat(web): board, task chat/timeline and quota bar"`

---

### Task 13: Kiểm chứng với CLI thật

**Files:**

- Modify: `README.md` (thêm mục "Đã kiểm với": phiên bản Claude Code và Codex)
- Modify: `packages/adapters/test/fixtures/README.md` (nếu đã thu được output hết quota thật)

- [ ] **Step 1:** Chạy `corepack pnpm test && corepack pnpm typecheck && corepack pnpm -r build`. Kết quả mong đợi: mọi thứ pass.
- [ ] **Step 2:** Chạy `voragent` với cấu hình mặc định. Tạo task "thêm một dòng vào README" trên một repo thử có việc dở. Kết quả mong đợi:
  - Claude chạy trong `~/.voragent/worktrees/task-1`;
  - thư mục gốc của repo thử không đổi;
  - nhánh `voragent/task-1` có commit;
  - web hiện dòng thời gian có tool call.
- [ ] **Step 3:** Gửi lượt thứ hai "giờ xóa dòng đó đi". Kết quả mong đợi: lượt này tiếp tục cùng phiên Claude, dòng thời gian có hai lượt.
- [ ] **Step 4:** Nếu đã cài Codex: chạy `voragent` với `config.json` `{"priority":["codex","claude"]}`, rồi lặp lại Step 2. Kết quả mong đợi: Codex chạy và báo `TOOL_CALL_*`.
- [ ] **Step 5:** Ghi phiên bản CLI đã kiểm vào README. Nếu thu được output hết quota thật thì thay fixture dựng tay bằng bản thật và chạy lại test.
- [ ] **Step 6: Commit.** `git commit -m "docs: verified CLI versions"`
