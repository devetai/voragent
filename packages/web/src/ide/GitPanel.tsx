import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  Undo2,
  RefreshCw,
  Trash2,
  FolderGit2,
  ArrowUp,
  ArrowDown,
  FolderTree,
  List,
  Folder,
  FolderOpen,
  ChevronRight,
} from 'lucide-react';
import type { GitFileStatus, GitStatusResult, GitWorktreeInfo } from '@voragent/shared';
import { api, errText } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';

interface GitPanelProps {
  cwd: string;
  onSelectDiff: (file: { path: string; staged: boolean }) => void;
  onSwitchWorktree: (worktreePath: string) => void;
}

interface GitTreeNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  file?: GitFileStatus;
  children: GitTreeNode[];
}

function buildGitTree(files: GitFileStatus[]): GitTreeNode[] {
  const root: GitTreeNode[] = [];

  for (const file of files) {
    const parts = file.path.split('/');
    let currentLevel = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isFile = i === parts.length - 1;

      let existing = currentLevel.find((n) => n.name === part);
      if (!existing) {
        existing = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'directory',
          file: isFile ? file : undefined,
          children: [],
        };
        currentLevel.push(existing);
      }
      if (!isFile) {
        currentLevel = existing.children;
      }
    }
  }

  const sortNodes = (nodes: GitTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);
  return root;
}

export function GitPanel({ cwd, onSelectDiff, onSwitchWorktree }: GitPanelProps) {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // View mode: 'tree' | 'list'
  const [viewMode, setViewMode] = useState<'tree' | 'list'>('tree');

  // Collapsible sections
  const [isStagedCollapsed, setIsStagedCollapsed] = useState(false);
  const [isChangesCollapsed, setIsChangesCollapsed] = useState(false);
  const [isWorktreesCollapsed, setIsWorktreesCollapsed] = useState(false);

  // Expanded directory paths in tree view
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Commit
  const [commitMessage, setCommitMessage] = useState('');
  const [committing, setCommitting] = useState(false);

  // Discard file confirm
  const [discardingPath, setDiscardingPath] = useState<string | null>(null);

  // Remove worktree confirm
  const [removingWorktree, setRemovingWorktree] = useState<GitWorktreeInfo | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.ideGitStatus(cwd);
      setStatus(res);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Auto-expand all directories on tree load
  useEffect(() => {
    if (status?.files) {
      const dirs = new Set<string>();
      for (const f of status.files) {
        const parts = f.path.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
          cur = cur ? `${cur}/${parts[i]}` : parts[i]!;
          dirs.add(cur);
        }
      }
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        dirs.forEach((d) => next.add(d));
        return next;
      });
    }
  }, [status]);

  const toggleDir = (dirPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const handleStage = async (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.ideGitStage(cwd, [path]);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleStageAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!status) return;
    const unstaged = status.files.filter((f) => !f.staged).map((f) => f.path);
    if (unstaged.length === 0) return;
    try {
      await api.ideGitStage(cwd, unstaged);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleUnstage = async (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await api.ideGitUnstage(cwd, [path]);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleUnstageAll = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!status) return;
    const staged = status.files.filter((f) => f.staged).map((f) => f.path);
    if (staged.length === 0) return;
    try {
      await api.ideGitUnstage(cwd, staged);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleDiscardConfirm = async () => {
    if (!discardingPath) return;
    try {
      await api.ideGitDiscard(cwd, [discardingPath]);
      setDiscardingPath(null);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setCommitting(true);
    try {
      await api.ideGitCommit(cwd, commitMessage.trim());
      setCommitMessage('');
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    } finally {
      setCommitting(false);
    }
  };

  const handleRemoveWorktreeConfirm = async () => {
    if (!removingWorktree) return;
    try {
      await api.ideGitRemoveWorktree(cwd, removingWorktree.path, true);
      setRemovingWorktree(null);
      await loadStatus();
    } catch (err) {
      setError(errText(err));
    }
  };

  const stagedFiles = useMemo(() => status?.files.filter((f) => f.staged) || [], [status]);
  const unstagedFiles = useMemo(() => status?.files.filter((f) => !f.staged) || [], [status]);

  const stagedTree = useMemo(() => buildGitTree(stagedFiles), [stagedFiles]);
  const unstagedTree = useMemo(() => buildGitTree(unstagedFiles), [unstagedFiles]);

  if (!status?.isGit && !loading) {
    return (
      <div className="ide-git-panel">
        <div className="ide-panel-header">
          <span className="ide-panel-title">SOURCE CONTROL</span>
        </div>
        <div className="ide-empty-message">Thư mục hiện tại chưa được khởi tạo Git.</div>
      </div>
    );
  }

  // Render tree node for either staged or unstaged
  const renderTreeNode = (node: GitTreeNode, depth: number, staged: boolean): React.ReactNode => {
    if (node.type === 'directory') {
      const isExpanded = expandedDirs.has(node.path);
      return (
        <React.Fragment key={`${staged ? 'staged-dir' : 'unstaged-dir'}-${node.path}`}>
          <div
            className="ide-git-tree-dir"
            style={{ paddingLeft: `${depth * 14 + 6}px` }}
            onClick={(e) => toggleDir(node.path, e)}
          >
            <ChevronRight
              size={11}
              className={`ide-section-chevron ${isExpanded ? 'expanded' : ''}`}
            />
            {isExpanded ? (
              <FolderOpen size={13} color="var(--primary)" />
            ) : (
              <Folder size={13} color="var(--primary)" />
            )}
            <span className="ide-git-dir-name">{node.name}</span>
          </div>
          {isExpanded &&
            node.children.map((child) => renderTreeNode(child, depth + 1, staged))}
        </React.Fragment>
      );
    }

    const f = node.file!;
    return (
      <div
        key={`${staged ? 'staged' : 'unstaged'}-${f.path}`}
        className="ide-git-file-item"
        style={{ paddingLeft: `${depth * 14 + 16}px` }}
        onClick={() => onSelectDiff({ path: f.path, staged })}
      >
        <span className={`ide-git-badge ${f.status}`}>
          {f.status === 'untracked' ? 'U' : (f.status[0] || 'M').toUpperCase()}
        </span>
        <span className="ide-git-file-name" title={f.path}>
          {node.name}
        </span>
        <div className="ide-git-item-actions" onClick={(e) => e.stopPropagation()}>
          {staged ? (
            <button
              className="icon-btn-sm"
              aria-label="Bỏ stage"
              onClick={(e) => handleUnstage(f.path, e)}
            >
              <Minus size={12} />
            </button>
          ) : (
            <>
              <button
                className="icon-btn-sm"
                aria-label="Stage tệp"
                onClick={(e) => handleStage(f.path, e)}
              >
                <Plus size={12} />
              </button>
              <button
                className="icon-btn-sm danger"
                aria-label="Hủy bỏ thay đổi"
                onClick={(e) => {
                  e.stopPropagation();
                  setDiscardingPath(f.path);
                }}
              >
                <Undo2 size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // Render flat list item
  const renderListItem = (f: GitFileStatus, staged: boolean) => (
    <div
      key={`${staged ? 'staged' : 'unstaged'}-${f.path}`}
      className="ide-git-file-item"
      onClick={() => onSelectDiff({ path: f.path, staged })}
    >
      <span className={`ide-git-badge ${f.status}`}>
        {f.status === 'untracked' ? 'U' : (f.status[0] || 'M').toUpperCase()}
      </span>
      <span className="ide-git-file-name" title={f.path}>
        {f.path}
      </span>
      <div className="ide-git-item-actions" onClick={(e) => e.stopPropagation()}>
        {staged ? (
          <button
            className="icon-btn-sm"
            aria-label="Bỏ stage"
            onClick={(e) => handleUnstage(f.path, e)}
          >
            <Minus size={12} />
          </button>
        ) : (
          <>
            <button
              className="icon-btn-sm"
              aria-label="Stage tệp"
              onClick={(e) => handleStage(f.path, e)}
            >
              <Plus size={12} />
            </button>
            <button
              className="icon-btn-sm danger"
              aria-label="Hủy bỏ thay đổi"
              onClick={(e) => {
                e.stopPropagation();
                setDiscardingPath(f.path);
              }}
            >
              <Undo2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="ide-git-panel">
      {/* Top Header */}
      <div className="ide-panel-header">
        <div className="ide-git-branch-badge">
          <GitBranch size={13} />
          <span>{status?.branch || 'HEAD'}</span>
          {(status?.ahead ?? 0) > 0 && (
            <span className="ide-ahead-badge" data-tooltip={`${status?.ahead} commit chưa push`}>
              <ArrowUp size={10} />
              {status?.ahead}
            </span>
          )}
          {(status?.behind ?? 0) > 0 && (
            <span className="ide-behind-badge" data-tooltip={`${status?.behind} commit chưa pull`}>
              <ArrowDown size={10} />
              {status?.behind}
            </span>
          )}
        </div>

        <div className="ide-panel-actions">
          {/* Nút chuyển đổi Tree View / List View */}
          <button
            className={`icon-btn-sm ${viewMode === 'tree' ? 'active' : ''}`}
            aria-label={viewMode === 'tree' ? 'Xem danh sách phẳng' : 'Xem dạng cây'}
            onClick={() => setViewMode((prev) => (prev === 'tree' ? 'list' : 'tree'))}
          >
            {viewMode === 'tree' ? <List size={13} /> : <FolderTree size={13} />}
          </button>

          <button
            className="icon-btn-sm"
            aria-label="Làm mới"
            onClick={loadStatus}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="ide-error-banner">{error}</div>}

      <div className="ide-git-scroll-container">
        {/* Commit Input Box */}
        <div className="ide-commit-box">
          <textarea
            placeholder="Nội dung commit... (Ctrl+Enter)"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                handleCommit();
              }
            }}
            rows={2}
          />
          <button
            className="ide-btn-commit"
            onClick={handleCommit}
            disabled={committing || !commitMessage.trim() || stagedFiles.length === 0}
          >
            <GitCommit size={14} />
            <span>{committing ? 'Đang commit...' : 'Commit'}</span>
          </button>
        </div>

        {/* Staged Changes Section (Collapsible) */}
        <div className="ide-git-section">
          <div className="ide-git-section-header">
            <div
              className="ide-git-section-title"
              onClick={() => setIsStagedCollapsed(!isStagedCollapsed)}
            >
              <ChevronRight
                size={12}
                className={`ide-section-chevron ${!isStagedCollapsed ? 'expanded' : ''}`}
              />
              <span>ĐÃ STAGE ({stagedFiles.length})</span>
            </div>
            {!isStagedCollapsed && stagedFiles.length > 0 && (
              <button
                className="icon-btn-sm"
                aria-label="Bỏ stage tất cả"
                onClick={handleUnstageAll}
              >
                <Minus size={12} />
              </button>
            )}
          </div>

          {!isStagedCollapsed && (
            <div className="ide-git-section-body">
              {stagedFiles.length === 0 ? (
                <div className="ide-git-empty-section">Chưa có thay đổi nào được stage</div>
              ) : viewMode === 'tree' ? (
                stagedTree.map((node) => renderTreeNode(node, 0, true))
              ) : (
                stagedFiles.map((f) => renderListItem(f, true))
              )}
            </div>
          )}
        </div>

        {/* Working Changes Section (Collapsible) */}
        <div className="ide-git-section">
          <div className="ide-git-section-header">
            <div
              className="ide-git-section-title"
              onClick={() => setIsChangesCollapsed(!isChangesCollapsed)}
            >
              <ChevronRight
                size={12}
                className={`ide-section-chevron ${!isChangesCollapsed ? 'expanded' : ''}`}
              />
              <span>THAY ĐỔI ({unstagedFiles.length})</span>
            </div>
            {!isChangesCollapsed && unstagedFiles.length > 0 && (
              <button
                className="icon-btn-sm"
                aria-label="Stage toàn bộ"
                onClick={handleStageAll}
              >
                <Plus size={12} />
              </button>
            )}
          </div>

          {!isChangesCollapsed && (
            <div className="ide-git-section-body">
              {unstagedFiles.length === 0 ? (
                <div className="ide-git-empty-section">Thư mục làm việc sạch sẽ</div>
              ) : viewMode === 'tree' ? (
                unstagedTree.map((node) => renderTreeNode(node, 0, false))
              ) : (
                unstagedFiles.map((f) => renderListItem(f, false))
              )}
            </div>
          )}
        </div>

        {/* Worktrees Management Section (Collapsible) */}
        {status?.worktrees && status.worktrees.length > 0 && (
          <div className="ide-git-section worktrees-section">
            <div className="ide-git-section-header">
              <div
                className="ide-git-section-title"
                onClick={() => setIsWorktreesCollapsed(!isWorktreesCollapsed)}
              >
                <ChevronRight
                  size={12}
                  className={`ide-section-chevron ${!isWorktreesCollapsed ? 'expanded' : ''}`}
                />
                <span>GIT WORKTREES ({status.worktrees.length})</span>
              </div>
            </div>

            {!isWorktreesCollapsed && (
              <div className="ide-git-section-body">
                {status.worktrees.map((wt) => {
                  const isCurrent = wt.path.toLowerCase() === cwd.toLowerCase();
                  return (
                    <div
                      key={wt.path}
                      className={`ide-worktree-item ${isCurrent ? 'active' : ''}`}
                      onClick={() => !isCurrent && onSwitchWorktree(wt.path)}
                    >
                      <FolderGit2 size={14} className="ide-wt-icon" />
                      <div className="ide-wt-info">
                        <div className="ide-wt-title">
                          <span className="ide-wt-branch">{wt.branch || wt.head}</span>
                          {wt.isMain && <span className="ide-main-badge">Chính</span>}
                          {wt.taskSeq && <span className="ide-task-badge">Task #{wt.taskSeq}</span>}
                        </div>
                        <div className="ide-wt-path">{wt.path}</div>
                      </div>
                      {!wt.isMain && !isCurrent && (
                        <button
                          className="icon-btn-sm danger"
                          aria-label="Xóa worktree"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemovingWorktree(wt);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {discardingPath && (
        <ConfirmModal
          isOpen={true}
          title="Xác nhận hủy thay đổi"
          message={`Bạn có chắc chắn muốn hủy bỏ mọi sửa đổi trên tệp "${discardingPath}"? Mọi nội dung chưa lưu sẽ bị xóa vĩnh viễn.`}
          confirmText="Hủy bỏ thay đổi"
          cancelText="Giữ lại"
          confirmVariant="danger"
          onConfirm={handleDiscardConfirm}
          onCancel={() => setDiscardingPath(null)}
        />
      )}

      {removingWorktree && (
        <ConfirmModal
          isOpen={true}
          title="Xác nhận xóa Git Worktree"
          message={`Bạn có chắc muốn xóa worktree tại "${removingWorktree.path}" (nhánh ${removingWorktree.branch})?`}
          confirmText="Xóa Worktree"
          cancelText="Hủy"
          confirmVariant="danger"
          onConfirm={handleRemoveWorktreeConfirm}
          onCancel={() => setRemovingWorktree(null)}
        />
      )}
    </div>
  );
}
