import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Project, ProviderState, WorkspaceMode } from '@voragent/shared';
import { api, errText } from './api';

// Nhãn theo mục 6.2 của tài liệu thiết kế.
const MODE_LABEL: Record<WorkspaceMode, string> = {
  'head-dirty-commit': 'Từ HEAD, mang theo việc dở, agent tự commit (Khuyến nghị)',
  'head-commit': 'Chỉ từ HEAD, agent tự commit',
  'dirty-nocommit': 'Mang theo việc dở, không commit',
};

const OTHER = '__other__';

function effectiveChoice(picked: string | null, projects: Project[], initialPath: string | null): string {
  if (picked !== null) return picked;
  if (initialPath !== null && projects.some((p) => p.path === initialPath)) return initialPath;
  return projects[0]?.path ?? OTHER;
}

export function NewTaskForm({
  providers,
  projects,
  initialPath,
  onCreated,
  onCancel,
}: {
  providers: ProviderState[];
  projects: Project[];
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
      (t) => {
        setBusy(false);
        onCreated(t.id);
      },
      (e: unknown) => {
        setBusy(false);
        setError(errText(e));
      },
    );
  };

  return (
    <form className="panel form" onSubmit={submit} style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div className="task-nav">
        <h2>Tạo Task Mới</h2>
        <button type="button" onClick={onCancel} title="Hủy bỏ (Phím tắt: Esc)">
          ✕ Đóng <kbd>Esc</kbd>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Dự án (Project)
          </label>
          <select value={choice} onChange={(e) => setChoice(e.target.value)} required>
            {choice === '' && <option value="">Chọn dự án…</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.path}>
                {p.name} — {p.path}
              </option>
            ))}
            <option value={OTHER}>Thư mục khác…</option>
          </select>
        </div>

        {choice === OTHER && (
          <div>
            <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Đường dẫn thư mục / Repo Git
            </label>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="D:\Projects\my-project"
              required
              className="mono"
              autoFocus
            />
            <div className="muted" style={{ marginTop: '0.35rem' }}>
              Lưu ý: Nếu thư mục không phải repo Git, agent sẽ làm việc trực tiếp tại chỗ mà không có cách ly worktree.
            </div>
          </div>
        )}

        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Yêu cầu công việc (Prompt ban đầu)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Mô tả chi tiết tính năng cần thêm, bug cần fix, hoặc tài liệu cần viết…"
            required
          />
        </div>

        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Chế độ không gian làm việc (Git Worktree Mode)
          </label>
          <select value={mode} onChange={(e) => setMode(e.target.value as WorkspaceMode)}>
            {(Object.keys(MODE_LABEL) as WorkspaceMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Nền tảng thực thi ưu tiên
          </label>
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Tự động điều phối theo thứ tự ưu tiên (Mặc định)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} {p.version ? `(${p.version})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error !== null && (
        <div className="error" role="alert" style={{ marginTop: '1rem' }}>
          {error}
        </div>
      )}

      <div className="row" style={{ marginTop: '1.5rem', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Hủy bỏ <kbd>Esc</kbd>
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Đang khởi tạo…' : 'Bắt đầu thực thi'}
        </button>
      </div>
    </form>
  );
}
