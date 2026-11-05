import { useEffect, useState } from 'react';
import type { Task, VEvent } from '@voragent/shared';
import { api, errText } from './api';
import type { Diff } from './api';
import { isUnisolated, transcript } from './state';

export function TaskView({
  task, events, onLoaded, onBack,
}: {
  task: Task;
  events: VEvent[];
  onLoaded: (taskId: string, events: VEvent[]) => void;
  onBack: () => void;
}) {
  const [diff, setDiff] = useState<Diff | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tải lịch sử đầy đủ khi mở.
  useEffect(() => {
    let live = true;
    api.task(task.id).then(
      (d) => { if (live) onLoaded(task.id, d.events); },
      (e: unknown) => { if (live) setError(errText(e)); },
    );
    return () => { live = false; };
  }, [task.id, onLoaded]);

  // Tải lại diff mỗi khi trạng thái đổi.
  useEffect(() => {
    let live = true;
    api.diff(task.id).then(
      (d) => { if (live) setDiff(d); },
      (e: unknown) => { if (live) setError(errText(e)); },
    );
    return () => { live = false; };
  }, [task.id, task.status]);

  const act = (fn: () => Promise<unknown>, after?: () => void): void => {
    setBusy(true);
    setError(null);
    fn().then(
      () => { setBusy(false); after?.(); },
      (e: unknown) => { setBusy(false); setError(errText(e)); },
    );
  };

  const canSend = task.status === 'awaiting_user' || task.status === 'failed';
  const items = transcript(events);

  // Nội dung agent là dữ liệu không tin cậy: luôn render như văn bản thuần (React tự thoát ký tự).
  return (
    <div className="panel">
      <button onClick={onBack}>← Bảng</button>
      <h2>#{task.seq} {task.title}</h2>
      <div className="muted">
        {task.status} · {task.currentProvider ?? '—'} · {task.workspacePath ?? task.repoPath}
        {task.branch !== null ? ` · ${task.branch}` : ''}
        {isUnisolated(task) && (
          <span className="badge warn"> · ⚠ không cách ly: thư mục không phải repo git, agent làm việc trực tiếp ở đây</span>
        )}
      </div>

      <div className="transcript">
        {items.map((it, i) =>
          it.kind === 'handoff' ? (
            <hr key={i} className="handoff" data-label={it.text} />
          ) : (
            <div key={i} className={`msg ${it.kind}`}>{it.text}</div>
          ))}
        {items.length === 0 && <div className="muted">Chưa có nội dung.</div>}
      </div>

      <h3>Thay đổi</h3>
      {diff === null ? <div className="muted">Đang tải…</div> : (
        <div>
          {diff.commits.length > 0 && <pre className="diff">{diff.commits.join('\n')}</pre>}
          {diff.status !== '' && <pre className="diff">{diff.status}</pre>}
          <pre className="diff">{diff.diff === '' ? '(không có thay đổi)' : diff.diff}</pre>
        </div>
      )}

      {error !== null && <div className="error" role="alert">{error}</div>}
      <textarea
        value={text} rows={3} placeholder="Tin nhắn tiếp theo…" disabled={!canSend}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row">
        <button
          disabled={busy || !canSend || text.trim() === ''}
          onClick={() => act(() => api.send(task.id, text.trim()), () => setText(''))}
        >Gửi</button>
        <button disabled={busy || task.status === 'closed'} onClick={() => act(() => api.close(task.id))}>Xong</button>
        <button disabled={busy || task.status !== 'failed'} onClick={() => act(() => api.retry(task.id, false))}>
          Chạy lại
        </button>
        <button disabled={busy || task.status !== 'failed'} onClick={() => act(() => api.retry(task.id, true))}>
          Chuyển nền tảng khác
        </button>
      </div>
    </div>
  );
}
