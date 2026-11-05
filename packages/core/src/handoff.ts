import type { ProviderId, Task, Turn, VEvent } from '@voragent/shared';

export interface HandoffInput {
  task: Task;
  turns: Turn[];
  events: VEvent[];
  fromProvider: ProviderId;
  reason: 'quota' | 'interrupted';
  summary: { status: string; diff: string; commits: string[] };
  maxChars: number;
}

const CLOSING = 'Tiếp tục công việc từ đây. Kiểm tra lại trạng thái file trước khi sửa thêm.';
const MAX_ACTION_LINES = 60;
const ARG_CHARS = 120;
const TURN_ANSWER_CHARS = 500;
const FINAL_ANSWER_CHARS = 1500;

/** Keep the END of `s`, at most `n` chars including a leading ellipsis. */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  if (n <= 0) return '';
  return `…${s.slice(s.length - (n - 1))}`;
}

/** Keep the START of `s`, at most `n` chars including a trailing ellipsis. */
function head(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, Math.max(0, n - 1))}…`;
}

/** Last `n` chars of `s`, marked with a leading ellipsis when cut. */
function lastChars(s: string, n: number): string {
  return s.length <= n ? s : `…${s.slice(s.length - n)}`;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function actionLines(events: VEvent[]): string[] {
  const calls: { name: string; args: string }[] = [];
  const latest = new Map<string, { name: string; args: string }>();
  for (const e of events) {
    if (e.type === 'TOOL_CALL_START') {
      const call = { name: str(e.data.toolCallName), args: '' };
      calls.push(call);
      latest.set(str(e.data.toolCallId), call);
    } else if (e.type === 'TOOL_CALL_ARGS') {
      const call = latest.get(str(e.data.toolCallId));
      if (call) call.args += str(e.data.delta);
    }
  }
  return calls.map((c) => {
    const squeezed = c.args.replace(/\s+/g, ' ').trim();
    return squeezed ? `- ${c.name} ${head(squeezed, ARG_CHARS)}` : `- ${c.name}`;
  });
}

function finalAnswer(events: VEvent[]): string {
  let runId: string | null = null;
  for (const e of events) if (e.runId !== null) runId = e.runId;
  if (runId === null) return '';
  let text = '';
  for (const e of events) {
    if (e.runId === runId && e.type === 'TEXT_MESSAGE_CONTENT') text += str(e.data.delta);
  }
  return lastChars(text, FINAL_ANSWER_CHARS);
}

export function buildHandoff(o: HandoffInput): string {
  const first = o.turns.find((t) => t.index === 0) ?? o.turns[0];
  const request = first ? first.message : '';
  const earlier = o.turns
    .filter((t) => t.index !== 0 && t.status === 'done')
    .map((t) => `Người dùng: ${t.message}\nAgent: ${lastChars(t.answer ?? '', TURN_ANSWER_CHARS)}`);
  const allActions = actionLines(o.events);
  const total = allActions.length;
  const files = new Set<string>();
  for (const e of o.events) if (e.type === 'FILE_CHANGED') files.add(str(e.data.path));
  const answer = finalAnswer(o.events);
  const reasonText = o.reason === 'quota' ? 'hết quota' : 'daemon bị ngắt';

  const render = (diff: string, keep: number): string => {
    const actions = keep > 0 ? allActions.slice(total - keep) : [];
    const omitted = total - actions.length;
    const actionBlock = [...(omitted > 0 ? [`(đã lược ${omitted} dòng cũ)`] : []), ...actions];
    return [
      `# Bàn giao từ ${o.fromProvider}`,
      `Lý do: ${reasonText}.`,
      '',
      '## Yêu cầu gốc',
      request,
      '',
      '## Các lượt trước',
      earlier.length ? earlier.join('\n\n') : '(chưa có)',
      '',
      '## Những gì đã làm',
      total === 0 ? '(chưa có)' : actionBlock.join('\n'),
      `Số file đã đổi: ${files.size} file.`,
      '',
      '## Câu trả lời cuối của agent trước',
      answer || '(chưa có)',
      '',
      '## Trạng thái git',
      'Status:',
      o.summary.status || '(sạch)',
      'Commit:',
      o.summary.commits.length ? o.summary.commits.map((c) => `- ${c}`).join('\n') : '(chưa có)',
      'Diff:',
      diff || '(trống)',
      '',
      CLOSING,
    ].join('\n');
  };

  let out = render(o.summary.diff, Math.min(total, MAX_ACTION_LINES));
  if (out.length <= o.maxChars) return out;

  // 1) shorten the diff, keeping its end
  const diff = o.summary.diff;
  const budget = diff.length - (out.length - o.maxChars);
  const cutDiff = budget > 1 ? tail(diff, budget) : '';
  out = render(cutDiff, Math.min(total, MAX_ACTION_LINES));
  if (out.length <= o.maxChars) return out;

  // 2) drop the oldest action lines
  for (let keep = Math.min(total, MAX_ACTION_LINES) - 1; keep >= 0; keep--) {
    out = render(cutDiff, keep);
    if (out.length <= o.maxChars) return out;
  }
  return out;
}
