import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Folder,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCommit,
  GitFork,
  Play,
  X,
} from 'lucide-react';
import type { Project, ProviderId, ProviderState, WorkspaceMode } from '@voragent/shared';
import { api, errText } from './api';
import { CustomSelect, type SelectOption } from './components/CustomSelect';
import { AgentPriorityMultiSelect } from './components/AgentPriorityMultiSelect';

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
  const [priorities, setPriorities] = useState<ProviderId[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tạo options cho CustomSelect Dự án
  const projectOptions: SelectOption[] = [
    ...projects.map((p) => ({
      value: p.path,
      label: p.name,
      sublabel: p.path,
      icon: <FolderGit2 size={16} color="var(--primary)" />,
      badge: p.sources.length > 0 ? p.sources.map((s) => s.source).join(', ') : undefined,
    })),
    {
      value: OTHER,
      label: 'Thư mục khác…',
      sublabel: 'Nhập đường dẫn kho mã nguồn thủ công',
      icon: <FolderPlus size={16} color="var(--amber-text)" />,
    },
  ];

  // Tạo options cho CustomSelect Chế độ Git Worktree
  const modeOptions: SelectOption<WorkspaceMode>[] = [
    {
      value: 'head-dirty-commit',
      label: 'Từ HEAD, mang việc dở (Khuyến nghị)',
      sublabel: 'Tạo commit ban đầu từ HEAD và mang toàn bộ file sửa dở sang worktree cách ly',
      badge: 'Khuyến nghị',
      badgeType: 'success',
      icon: <GitBranch size={16} color="var(--green-base)" />,
    },
    {
      value: 'head-commit',
      label: 'Chỉ từ HEAD (Sạch sẽ)',
      sublabel: 'Khởi tạo từ commit HEAD mới nhất, bỏ qua thay đổi dở dang ở repo chính',
      icon: <GitCommit size={16} color="var(--blue-base)" />,
    },
    {
      value: 'dirty-nocommit',
      label: 'Mang việc dở, không commit',
      sublabel: 'Chép việc sửa dở sang worktree nhưng không tạo commit ban đầu',
      icon: <GitFork size={16} color="var(--amber-base)" />,
    },
  ];

  const submit = (ev: FormEvent): void => {
    ev.preventDefault();
    if (!repoPath.trim()) {
      setError('Vui lòng chọn hoặc nhập đường dẫn dự án hợp lệ.');
      return;
    }
    setBusy(true);
    setError(null);

    const body = {
      repoPath: repoPath.trim(),
      message: message.trim(),
      mode,
      ...(priorities !== null && priorities.length > 0 ? { priority: priorities } : {}),
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
    <form className="panel form" onSubmit={submit} style={{ maxWidth: '720px', margin: '0 auto' }}>
      <div className="task-nav">
        <h2>Tạo Task Mới</h2>
        <button type="button" onClick={onCancel} title="Hủy bỏ (Phím tắt: Esc)">
          <X size={15} /> Đóng <kbd>Esc</kbd>
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1.25rem' }}>
        {/* 1. Chọn Dự án bằng CustomSelect */}
        <div className="form-group">
          <label className="form-label">
            Dự án (Project Workspace) <span className="text-danger">*</span>
          </label>
          <CustomSelect
            options={projectOptions}
            value={choice}
            onChange={(val) => setChoice(val)}
            placeholder="Tìm hoặc chọn một dự án..."
            searchPlaceholder="Gõ tên hoặc đường dẫn dự án..."
            searchable={projects.length >= 4}
          />
        </div>

        {/* Nhập đường dẫn thủ công nếu chọn Thư mục khác */}
        {choice === OTHER && (
          <div className="form-group">
            <label className="form-label">
              Đường dẫn thư mục / Repo Git <span className="text-danger">*</span>
            </label>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="D:\Projects\my-project"
              required
              className="mono"
              autoFocus
            />
            <div className="form-hint warn">
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span>Lưu ý: Nếu thư mục không phải repo Git, agent sẽ làm việc trực tiếp tại chỗ mà không có phân nhánh worktree cách ly.</span>
            </div>
          </div>
        )}

        {/* 2. Yêu cầu công việc (Prompt) */}
        <div className="form-group">
          <label className="form-label">
            Yêu cầu công việc (Initial Prompt) <span className="text-danger">*</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Mô tả cụ thể nhiệm vụ bạn muốn giao cho Agent: sửa lỗi, thêm tính năng, viết bài test, review mã nguồn..."
            required
          />
        </div>

        {/* 3. Chế độ Git Worktree bằng CustomSelect */}
        <div className="form-group">
          <label className="form-label">
            Chế độ cách ly Git Worktree
          </label>
          <CustomSelect
            options={modeOptions}
            value={mode}
            onChange={(val) => setMode(val as WorkspaceMode)}
            searchable={false}
          />
        </div>

        {/* 4. Điều phối Agent & Quota Handoff bằng AgentPriorityMultiSelect */}
        <div className="form-group">
          <label className="form-label">
            Điều phối Agent & Thứ tự ưu tiên Quota Handoff
          </label>
          <AgentPriorityMultiSelect
            providers={providers}
            value={priorities}
            onChange={setPriorities}
            disabled={busy}
          />
        </div>
      </div>

      {error !== null && (
        <div className="error banner" role="alert" style={{ marginTop: '1.25rem' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="row" style={{ marginTop: '1.75rem', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Hủy bỏ <kbd>Esc</kbd>
        </button>
        <button type="submit" className="primary" disabled={busy}>
          <Play size={14} /> {busy ? 'Đang khởi tạo…' : 'Bắt đầu thực thi'}
        </button>
      </div>
    </form>
  );
}
