import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Cpu,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCommit,
  GitFork,
  Play,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { Project, ProviderId, ProviderState, WorkspaceMode } from '@voragent/shared';
import { PROVIDER_MODELS } from '@voragent/shared';
import { api, errText } from './api';
import { CustomSelect, type SelectOption } from './components/CustomSelect';
import { AgentPriorityMultiSelect } from './components/AgentPriorityMultiSelect';
import { isProviderInstalledById, projectKeyOf } from './state';

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
  onRefreshProjects,
}: {
  providers: ProviderState[];
  projects: Project[];
  initialPath: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
  onRefreshProjects?: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState(initialPath ?? '');
  const choice = effectiveChoice(picked, projects, initialPath);
  const setChoice = (v: string): void => setPicked(v);
  const repoPath = choice === OTHER ? customPath : choice;

  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<WorkspaceMode>('head-dirty-commit');
  const [priorities, setPriorities] = useState<ProviderId[] | null>(null);
  const [model, setModel] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [initGitBusy, setInitGitBusy] = useState(false);

  const selectedProject = choice === OTHER
    ? undefined
    : projects.find((p) => projectKeyOf(p.path) === projectKeyOf(choice));
  const isGitRepo = selectedProject ? selectedProject.isGit : true;

  // Tạo options cho CustomSelect Dự án (chỉ hiển thị nguồn từ các CLI đã cài đặt, kèm cảnh báo nếu chưa có Git)
  const projectOptions: SelectOption[] = [
    ...projects.map((p) => {
      const installedSources = p.sources
        .map((s) => s.source)
        .filter((src) => isProviderInstalledById(providers, src));
      return {
        value: p.path,
        label: p.name,
        sublabel: p.path,
        icon: <FolderGit2 size={16} color={p.isGit ? 'var(--primary)' : 'var(--amber-base)'} />,
        badge: !p.isGit
          ? 'Chưa có Git'
          : installedSources.length > 0
          ? installedSources.join(', ')
          : undefined,
        badgeType: !p.isGit ? ('warn' as const) : ('default' as const),
      };
    }),
    {
      value: OTHER,
      label: 'Thư mục khác…',
      sublabel: 'Nhập đường dẫn kho mã nguồn thủ công',
      icon: <FolderPlus size={16} color="var(--amber-text)" />,
    },
  ];

  // Tạo options cho CustomSelect Chế độ Git Worktree (nếu dự án chưa có Git thì khóa các chế độ cần HEAD commit)
  const modeOptions: SelectOption<WorkspaceMode>[] = [
    {
      value: 'head-dirty-commit',
      label: 'Từ HEAD, mang việc dở (Khuyến nghị)',
      sublabel: 'Tạo commit ban đầu từ HEAD và mang toàn bộ file sửa dở sang worktree cách ly',
      badge: isGitRepo ? 'Khuyến nghị' : 'Cần Git',
      badgeType: isGitRepo ? 'success' : 'warn',
      icon: <GitBranch size={16} color="var(--green-base)" />,
      disabled: !isGitRepo,
    },
    {
      value: 'head-commit',
      label: 'Chỉ từ HEAD (Sạch sẽ)',
      sublabel: 'Khởi tạo từ commit HEAD mới nhất, bỏ qua thay đổi dở dang ở repo chính',
      badge: !isGitRepo ? 'Cần Git' : undefined,
      badgeType: 'warn',
      icon: <GitCommit size={16} color="var(--blue-base)" />,
      disabled: !isGitRepo,
    },
    {
      value: 'dirty-nocommit',
      label: 'Mang việc dở, không commit',
      sublabel: 'Chép việc sửa dở sang worktree nhưng không tạo commit ban đầu',
      badge: !isGitRepo ? 'Cần Git' : undefined,
      badgeType: 'warn',
      icon: <GitFork size={16} color="var(--amber-base)" />,
      disabled: !isGitRepo,
    },
  ];

  const handleInitGitForSelected = async () => {
    if (!selectedProject || initGitBusy) return;
    setInitGitBusy(true);
    setError(null);
    try {
      await api.initGit(selectedProject.path);
      onRefreshProjects?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setInitGitBusy(false);
    }
  };

  const submit = (ev: FormEvent): void => {
    ev.preventDefault();
    if (!repoPath.trim()) {
      setError('Vui lòng chọn hoặc nhập đường dẫn dự án hợp lệ.');
      return;
    }
    setBusy(true);
    setError(null);

    const validPriorities = priorities
      ? priorities.filter((id) => isProviderInstalledById(providers, id))
      : null;

    const body = {
      repoPath: repoPath.trim(),
      message: message.trim(),
      mode,
      ...(validPriorities !== null && validPriorities.length > 0 ? { priority: validPriorities } : {}),
      ...(model ? { model } : {}),
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
        <button
          type="button"
          className="icon-btn"
          onClick={onCancel}
          title="Đóng (Phím tắt: Esc)"
          aria-label="Đóng"
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem', marginTop: '1rem' }}>
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
          {selectedProject && !selectedProject.isGit && (
            <div className="form-hint warn" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                <span>Thư mục này chưa có Git (sẽ chạy trực tiếp không có worktree cách ly).</span>
              </span>
              <button
                type="button"
                className="office-mini-btn"
                disabled={initGitBusy}
                onClick={() => { void handleInitGitForSelected(); }}
                style={{ borderColor: '#F59E0B', background: '#FEF3C7', color: '#92400E', fontWeight: 600 }}
              >
                <GitBranch size={11} />
                <span>{initGitBusy ? 'Đang khởi tạo Git…' : '+ Khởi tạo Git ngay'}</span>
              </button>
            </div>
          )}
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

        {/* 3. Progressive Disclosure (Hick's Law & Rule 11): Ẩn cấu hình nâng cao sau nút bấm gọn gàng */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            style={{
              width: '100%',
              justifyContent: 'space-between',
              background: 'var(--bg-canvas)',
              borderStyle: 'dashed',
              fontSize: '0.825rem',
              color: 'var(--text-secondary)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
              <SlidersHorizontal size={14} />
              <span>Tùy chọn nâng cao: Git Worktree & Thứ tự ưu tiên Agent</span>
              <span className="badge neutral" style={{ fontSize: '11px' }}>
                {priorities === null ? 'Tự động tối ưu' : `Tùy chỉnh (${priorities.length})`}
              </span>
            </span>
            <ChevronDown
              size={15}
              style={{
                transform: showAdvanced ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>

          {showAdvanced && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                marginTop: '0.75rem',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="form-group">
                <label className="form-label">
                  Chế độ cách ly Git Worktree {!isGitRepo && <span className="badge warn">Cần khởi tạo Git</span>}
                </label>
                <CustomSelect
                  options={modeOptions}
                  value={mode}
                  onChange={(val) => setMode(val as WorkspaceMode)}
                  searchable={false}
                  disabled={!isGitRepo}
                />
              </div>

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

              {(() => {
                const primary = (priorities?.[0] ?? providers.find((p) => p.installed)?.id ?? 'claude').toLowerCase();
                const models = PROVIDER_MODELS[primary] ?? [];
                if (models.length === 0) return null;
                const defaultModel = models.find((m) => m.default)?.id || models[0]?.id;
                const modelOpts: SelectOption[] = models.map((m) => ({
                  value: m.id,
                  label: m.name,
                  sublabel: m.description,
                  badge: m.default ? 'Mặc định' : undefined,
                  badgeType: m.default ? 'info' : undefined,
                }));
                return (
                  <div className="form-group">
                    <label className="form-label">
                      Mô hình AI thực thi ({primary.toUpperCase()})
                    </label>
                    <CustomSelect
                      options={modelOpts}
                      value={model || defaultModel || ''}
                      onChange={setModel}
                      searchable={false}
                      icon={<Cpu size={14} style={{ color: 'var(--amber-base)' }} />}
                    />
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>

      {error !== null && (
        <div className="error banner" role="alert" style={{ marginTop: '1.25rem' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="row" style={{ marginTop: '1.5rem', justifyContent: 'flex-end', gap: '0.75rem' }}>
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
