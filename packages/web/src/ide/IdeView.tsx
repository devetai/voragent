import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FolderGit2,
  GitBranch,
  Terminal,
  Columns,
  ArrowLeft,
  Files,
  Maximize2,
  Minimize2,
  AlertCircle,
  X,
} from 'lucide-react';
import type { GitStatusResult, Project } from '@voragent/shared';
import { api, errText } from '../api';
import { CustomSelect, type SelectOption } from '../components/CustomSelect';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { CodeEditor, type OpenFileTab } from './CodeEditor';
import { DiffViewer } from './DiffViewer';
import { WebTerminal } from './WebTerminal';

interface IdeViewProps {
  initialProjectPath: string | null;
  initialWorktreePath?: string | null;
  initialTaskSeq?: number | null;
  projects: Project[];
  onNavigate: (view: 'projects' | 'board' | 'office' | 'ide', projectPath?: string | null) => void;
}

export function IdeView({
  initialProjectPath,
  initialWorktreePath,
  initialTaskSeq,
  projects,
  onNavigate,
}: IdeViewProps) {
  // Dự án đang chọn
  const [selectedProject, setSelectedProject] = useState<string>(
    initialProjectPath || projects[0]?.path || ''
  );

  // Cwd hiện tại (có thể là project root hoặc một worktree)
  const [activeCwd, setActiveCwd] = useState<string>(
    initialWorktreePath || initialProjectPath || projects[0]?.path || ''
  );

  // Tab sidebar: 'files' | 'git'
  const [sidebarTab, setSidebarTab] = useState<'files' | 'git'>('files');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Terminal drawer
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalHeight] = useState(240);

  // Fullscreen mode (Toàn màn hình)
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Editor tabs
  const [openTabs, setOpenTabs] = useState<OpenFileTab[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // Diff viewer state
  const [viewingDiff, setViewingDiff] = useState<{ path: string; staged: boolean } | null>(null);

  // Git status summary for topbar
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);

  // Inline toast error (Rule 15: Zero native alert)
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  // Cập nhật khi props đổi
  useEffect(() => {
    if (initialProjectPath) {
      setSelectedProject(initialProjectPath);
    }
    if (initialWorktreePath) {
      setActiveCwd(initialWorktreePath);
    } else if (initialProjectPath) {
      setActiveCwd(initialProjectPath);
    }
  }, [initialProjectPath, initialWorktreePath]);

  // Tải trạng thái git cho topbar
  const loadGit = useCallback(async () => {
    const targetCwd = activeCwd || initialWorktreePath || initialProjectPath || selectedProject;
    if (!targetCwd) return;
    try {
      const res = await api.ideGitStatus(targetCwd);
      setGitStatus(res);

      // Tự động chuyển đúng Worktree / Branch tương ứng với task hoặc worktree path
      if (res.worktrees && res.worktrees.length > 0) {
        const norm = (p?: string | null) => (p || '').replace(/\\/g, '/').toLowerCase().trim();
        let targetWt = res.worktrees.find((wt) => initialTaskSeq && wt.taskSeq === initialTaskSeq);
        if (!targetWt && initialWorktreePath) {
          const normTarget = norm(initialWorktreePath);
          targetWt = res.worktrees.find((wt) => norm(wt.path) === normTarget);
        }
        if (targetWt && activeCwd !== targetWt.path) {
          setActiveCwd(targetWt.path);
        }
      }
    } catch {
      setGitStatus(null);
    }
  }, [activeCwd, initialWorktreePath, initialProjectPath, selectedProject, initialTaskSeq]);

  useEffect(() => {
    loadGit();
  }, [loadGit]);

  // Danh sách options dự án cho CustomSelect
  const projectOptions: SelectOption[] = useMemo(() => {
    return projects.map((p) => ({
      value: p.path,
      label: p.name,
      icon: <FolderGit2 size={13} color="var(--primary)" />,
    }));
  }, [projects]);

  // Danh sách options worktree cho CustomSelect
  const worktreeOptions: SelectOption[] = useMemo(() => {
    return (gitStatus?.worktrees || []).map((wt) => ({
      value: wt.path,
      label: wt.isMain
        ? `${wt.branch || 'main'} (Kho chính)`
        : `${wt.branch || wt.head} (Worktree)`,
      badge: wt.isMain ? 'main' : wt.taskSeq ? `task #${wt.taskSeq}` : 'wt',
      icon: <GitBranch size={13} color="var(--primary)" />,
    }));
  }, [gitStatus?.worktrees]);

  // Mở tệp trong editor
  const handleSelectFile = async (relPath: string) => {
    setViewingDiff(null);

    const existing = openTabs.find((t) => t.path === relPath);
    if (existing) {
      setActiveFilePath(relPath);
      return;
    }

    try {
      const data = await api.ideReadFile(activeCwd, relPath);
      const name = relPath.split('/').pop() || relPath;
      const newTab: OpenFileTab = {
        path: relPath,
        name,
        content: data.content,
        originalContent: data.content,
        isDirty: false,
        isBinary: data.isBinary,
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveFilePath(relPath);
    } catch (e) {
      console.error('Không thể mở tệp tin:', e);
    }
  };

  const handleCloseTab = (path: string) => {
    const nextTabs = openTabs.filter((t) => t.path !== path);
    setOpenTabs(nextTabs);
    if (activeFilePath === path) {
      setActiveFilePath(nextTabs[nextTabs.length - 1]?.path || null);
    }
  };

  const handleChangeContent = (path: string, newContent: string) => {
    setOpenTabs((prev) =>
      prev.map((t) =>
        t.path === path
          ? {
              ...t,
              content: newContent,
              isDirty: newContent !== t.originalContent,
            }
          : t
      )
    );
  };

  const handleSaveFile = async (path: string) => {
    const tab = openTabs.find((t) => t.path === path);
    if (!tab || !tab.isDirty) return;

    try {
      await api.ideWriteFile(activeCwd, path, tab.content);
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? {
                ...t,
                originalContent: tab.content,
                isDirty: false,
              }
            : t
        )
      );
      loadGit();
    } catch (e) {
      setErrorNotice(`Lưu tệp thất bại: ${errText(e)}`);
      setTimeout(() => setErrorNotice(null), 4000);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl + S: Lưu tệp đang mở
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeFilePath) {
          handleSaveFile(activeFilePath);
        }
      }
      // Ctrl + `: Bật/tắt terminal
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setIsTerminalOpen((prev) => !prev);
      }
      // Ctrl + B: Bật/tắt sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
      }
      // F11: Toàn màn hình IDE
      if (e.key === 'F11') {
        e.preventDefault();
        setIsFullscreen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFilePath, openTabs]);

  return (
    <div className={`ide-shell ${isFullscreen ? 'is-fullscreen' : ''}`}>
      {/* Toast Error Alert (Rule 15) */}
      {errorNotice && (
        <div className="ide-toast-error">
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>{errorNotice}</span>
          <button
            type="button"
            className="icon-btn-sm"
            onClick={() => setErrorNotice(null)}
            style={{ marginLeft: 'auto', background: 'transparent', border: 'none', cursor: 'pointer' }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Top Context Toolbar */}
      <div className="ide-topbar">
        <div className="ide-topbar-left">
          <button
            className="ide-btn-back"
            onClick={() => onNavigate('board', selectedProject)}
          >
            <ArrowLeft size={13} />
            <span>Kanban</span>
          </button>

          <span className="ide-breadcrumb-sep">/</span>

          <span className="ide-brand-badge">VorStudio</span>

          <span className="ide-breadcrumb-sep">/</span>

          {/* Chọn dự án qua CustomSelect chuẩn hóa */}
          <div className="ide-nav-select">
            <CustomSelect
              options={projectOptions}
              value={selectedProject}
              onChange={(nextProj) => {
                setSelectedProject(nextProj);
                setActiveCwd(nextProj);
                setOpenTabs([]);
                setActiveFilePath(null);
                setViewingDiff(null);
              }}
              placeholder="Chọn dự án..."
              searchPlaceholder="Tìm dự án..."
            />
          </div>

          {/* Chọn Git Worktree qua CustomSelect */}
          {worktreeOptions.length > 1 && (
            <>
              <span className="ide-breadcrumb-sep">/</span>
              <div className="ide-nav-select worktree-select">
                <CustomSelect
                  options={worktreeOptions}
                  value={activeCwd}
                  onChange={(nextCwd) => {
                    setActiveCwd(nextCwd);
                    setOpenTabs([]);
                    setActiveFilePath(null);
                    setViewingDiff(null);
                  }}
                  placeholder="Chọn worktree..."
                  searchPlaceholder="Tìm worktree..."
                />
              </div>
            </>
          )}

          {/* Branch indicator */}
          {gitStatus?.branch && (
            <div className="ide-branch-indicator">
              <GitBranch size={11} />
              <span>{gitStatus.branch}</span>
            </div>
          )}
        </div>

        <div className="ide-topbar-right">
          <button
            className={`icon-btn-sm ${isSidebarOpen ? 'active' : ''}`}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            data-tooltip="Ẩn / Hiện thanh bên (Ctrl+B)"
            aria-label="Thanh bên"
          >
            <Columns size={14} />
          </button>

          <button
            className={`icon-btn-sm ${isTerminalOpen ? 'active' : ''}`}
            onClick={() => setIsTerminalOpen(!isTerminalOpen)}
            data-tooltip="Bật / Tắt Terminal (Ctrl+`)"
            aria-label="Terminal"
          >
            <Terminal size={14} />
          </button>

          <button
            className={`icon-btn-sm ${isFullscreen ? 'active' : ''}`}
            onClick={() => setIsFullscreen(!isFullscreen)}
            data-tooltip={isFullscreen ? 'Thu nhỏ cửa sổ (F11)' : 'Toàn màn hình IDE (F11)'}
            aria-label="Toàn màn hình"
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="ide-body">
        {/* Left Sidebar */}
        {isSidebarOpen && (
          <div className="ide-sidebar">
            <div className="ide-sidebar-tab-strip">
              <button
                className={`ide-strip-tab ${sidebarTab === 'files' ? 'active' : ''}`}
                onClick={() => setSidebarTab('files')}
              >
                <Files size={14} />
                <span>Tập tin</span>
              </button>
              <button
                className={`ide-strip-tab ${sidebarTab === 'git' ? 'active' : ''}`}
                onClick={() => setSidebarTab('git')}
              >
                <GitBranch size={14} />
                <span>Git</span>
                {gitStatus && gitStatus.files.length > 0 && (
                  <span className="ide-git-count-badge">{gitStatus.files.length}</span>
                )}
              </button>
            </div>

            <div className="ide-sidebar-content">
              {sidebarTab === 'files' ? (
                <FileTree
                  projectPath={activeCwd}
                  activeFilePath={activeFilePath}
                  onSelectFile={handleSelectFile}
                />
              ) : (
                <GitPanel
                  cwd={activeCwd}
                  onSelectDiff={(diffTarget) => setViewingDiff(diffTarget)}
                  onSwitchWorktree={(nextWt) => {
                    setActiveCwd(nextWt);
                    setOpenTabs([]);
                    setActiveFilePath(null);
                    setViewingDiff(null);
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* Center Main Stage (Editor or Diff Viewer) */}
        <div className="ide-main-stage">
          <div className="ide-editor-diff-pane">
            {viewingDiff ? (
              <DiffViewer
                cwd={activeCwd}
                filePath={viewingDiff.path}
                staged={viewingDiff.staged}
                onClose={() => setViewingDiff(null)}
                onRefreshGit={loadGit}
              />
            ) : (
              <CodeEditor
                tabs={openTabs}
                activePath={activeFilePath}
                onSelectTab={(path) => setActiveFilePath(path)}
                onCloseTab={handleCloseTab}
                onChangeContent={handleChangeContent}
                onSaveFile={handleSaveFile}
              />
            )}
          </div>

          {/* Bottom Terminal Drawer */}
          {isTerminalOpen && (
            <div className="ide-bottom-drawer" style={{ height: `${terminalHeight}px` }}>
              <WebTerminal cwd={activeCwd} onCloseDrawer={() => setIsTerminalOpen(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
