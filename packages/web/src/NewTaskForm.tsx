import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Project, ProviderState, WorkspaceMode } from '@voragent/shared';
import { api, errText } from './api';
import { OTHER, effectiveChoice } from './state';

// Nhãn theo mục 6.2 của tài liệu thiết kế.
const MODE_LABEL: Record<WorkspaceMode, string> = {
  'head-dirty-commit': 'Từ HEAD, mang theo việc dở, agent tự commit (mặc định)',
  'head-commit': 'Chỉ từ HEAD, agent tự commit',
  'dirty-nocommit': 'Mang theo việc dở, không commit',
};

export function NewTaskForm({
  providers, projects, initialPath, onCreated, onCancel,
}: {
  providers: ProviderState[];
  projects: Project[];
  /** Dự án đang xem (nếu có): được chọn sẵn. */
  initialPath: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState(initialPath ?? '');
  const choice = effectiveChoice(picked, projects, initialPath);
  const setChoice = (v: string): void => setPicked(v);
  const repoPath = choice === OTHER ? customPath : choice;
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<WorkspaceMode>('head-dirty-commit');
  const [agent, setAgent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (ev: FormEvent): void => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      repoPath: repoPath.trim(),
      message: message.trim(),
      mode,
      ...(agent !== '' ? { priority: [agent] } : {}),
    };
    api.createTask(body).then(
      (t) => { setBusy(false); onCreated(t.id); },
      (e: unknown) => { setBusy(false); setError(errText(e)); },
    );
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h2>Task mới</h2>
      <label>Dự án
        <select value={choice} onChange={(e) => setChoice(e.target.value)} required>
          {choice === '' && <option value="">Chọn dự án…</option>}
          {projects.map((p) => <option key={p.id} value={p.path}>{p.name} — {p.path}</option>)}
          <option value={OTHER}>Thư mục khác…</option>
        </select>
      </label>
      {choice === OTHER && (
        <label>Đường dẫn repo
          <input value={customPath} onChange={(e) => setCustomPath(e.target.value)} placeholder="D:\Projects\ten-repo" required />
        </label>
      )}
      <div className="muted">
        Nếu thư mục không phải repo git, agent sẽ làm việc trực tiếp trong đó, không cách ly (không có worktree, không commit).
      </div>
      <label>Tin nhắn
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} required />
      </label>
      <label>Chế độ worktree
        <select value={mode} onChange={(e) => setMode(e.target.value as WorkspaceMode)}>
          {(Object.keys(MODE_LABEL) as WorkspaceMode[]).map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
      </label>
      <label>Nền tảng (tùy chọn)
        <select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">Tự chọn theo thứ tự ưu tiên</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
      </label>
      {error !== null && <div className="error" role="alert">{error}</div>}
      <div className="row">
        <button type="submit" disabled={busy}>Tạo task</button>
        <button type="button" onClick={onCancel}>Hủy</button>
      </div>
    </form>
  );
}
