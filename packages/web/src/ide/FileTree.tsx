import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Trash2,
  Edit2,
  Check,
  X,
} from 'lucide-react';
import type { FileNode } from '@voragent/shared';
import { api, errText } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';

interface FileTreeProps {
  projectPath: string;
  activeFilePath: string | null;
  onSelectFile: (path: string) => void;
}

interface TreeNode extends FileNode {
  isExpanded?: boolean;
  isLoading?: boolean;
  children?: TreeNode[];
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
      return <FileCode size={15} className="ide-file-icon ts-icon" />;
    case 'json':
      return <FileJson size={15} className="ide-file-icon json-icon" />;
    case 'md':
    case 'txt':
      return <FileText size={15} className="ide-file-icon md-icon" />;
    case 'css':
    case 'scss':
      return <FileCode size={15} className="ide-file-icon css-icon" />;
    default:
      return <File size={15} className="ide-file-icon" />;
  }
}

export function FileTree({ projectPath, activeFilePath, onSelectFile }: FileTreeProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In-place creation
  const [creatingType, setCreatingType] = useState<'file' | 'directory' | null>(null);
  const [creatingParent, setCreatingParent] = useState<string>('');
  const [creatingName, setCreatingName] = useState<string>('');

  // In-place rename
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState<string>('');

  // Deletion confirm
  const [deletingPath, setDeletingPath] = useState<string | null>(null);

  const loadTree = useCallback(
    async (subDir = '', currentNodes: TreeNode[] = []): Promise<TreeNode[]> => {
      try {
        const res = await api.ideTree(projectPath, subDir);
        const mapped: TreeNode[] = res.nodes.map((n) => {
          // Bảo lưu trạng thái expanded nếu đã có trước đó
          const existing = currentNodes.find((old) => old.path === n.path);
          return {
            ...n,
            isExpanded: existing?.isExpanded ?? false,
            children: existing?.children,
          };
        });
        return mapped;
      } catch (e) {
        setError(errText(e));
        return [];
      }
    },
    [projectPath]
  );

  const refreshRoot = useCallback(async () => {
    setLoading(true);
    setError(null);
    const rootNodes = await loadTree('', nodes);
    setNodes(rootNodes);
    setLoading(false);
  }, [loadTree, nodes]);

  useEffect(() => {
    refreshRoot();
  }, [projectPath]);

  const toggleFolder = async (node: TreeNode) => {
    if (node.type !== 'directory') return;

    const nextExpanded = !node.isExpanded;

    // Helper recursive update
    const updateNode = async (list: TreeNode[]): Promise<TreeNode[]> => {
      const updated: TreeNode[] = [];
      for (const item of list) {
        if (item.path === node.path) {
          let children = item.children;
          if (nextExpanded && (!children || children.length === 0)) {
            item.isLoading = true;
            children = await loadTree(item.path);
            item.isLoading = false;
          }
          updated.push({
            ...item,
            isExpanded: nextExpanded,
            children,
          });
        } else if (item.children && item.children.length > 0) {
          updated.push({
            ...item,
            children: await updateNode(item.children),
          });
        } else {
          updated.push(item);
        }
      }
      return updated;
    };

    const newNodes = await updateNode(nodes);
    setNodes(newNodes);
  };

  const handleCreateSubmit = async () => {
    if (!creatingType || !creatingName.trim()) {
      setCreatingType(null);
      setCreatingName('');
      return;
    }
    const targetPath = creatingParent
      ? `${creatingParent}/${creatingName.trim()}`
      : creatingName.trim();
    try {
      await api.ideCreateItem(projectPath, targetPath, creatingType);
      setCreatingType(null);
      setCreatingName('');
      await refreshRoot();
      if (creatingType === 'file') {
        onSelectFile(targetPath);
      }
    } catch (e) {
      setError(errText(e));
    }
  };

  const handleRenameSubmit = async () => {
    if (!renamingPath || !renamingName.trim()) {
      setRenamingPath(null);
      setRenamingName('');
      return;
    }
    const parts = renamingPath.split('/');
    parts.pop();
    const newPath = parts.length > 0 ? `${parts.join('/')}/${renamingName.trim()}` : renamingName.trim();
    try {
      await api.ideRenameItem(projectPath, renamingPath, newPath);
      setRenamingPath(null);
      setRenamingName('');
      await refreshRoot();
      if (activeFilePath === renamingPath) {
        onSelectFile(newPath);
      }
    } catch (e) {
      setError(errText(e));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingPath) return;
    try {
      await api.ideDeleteItem(projectPath, deletingPath);
      setDeletingPath(null);
      await refreshRoot();
    } catch (e) {
      setError(errText(e));
    }
  };

  const renderNode = (node: TreeNode, depth = 0): React.ReactNode => {
    const isSelected = activeFilePath === node.path;
    const isRenaming = renamingPath === node.path;

    return (
      <div key={node.path} className="ide-tree-branch">
        <div
          className={`ide-tree-item ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => {
            if (node.type === 'directory') {
              toggleFolder(node);
            } else {
              onSelectFile(node.path);
            }
          }}
        >
          <span className="ide-tree-chevron">
            {node.type === 'directory' ? (
              node.isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )
            ) : (
              <span className="ide-chevron-spacer" />
            )}
          </span>

          <span className="ide-tree-icon">
            {node.type === 'directory' ? (
              node.isExpanded ? (
                <FolderOpen size={15} className="ide-folder-icon" />
              ) : (
                <Folder size={15} className="ide-folder-icon" />
              )
            ) : (
              getFileIcon(node.name)
            )}
          </span>

          {isRenaming ? (
            <div className="ide-tree-inline-input" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                type="text"
                value={renamingName}
                onChange={(e) => setRenamingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') setRenamingPath(null);
                }}
              />
              <button className="icon-btn-sm" onClick={handleRenameSubmit} aria-label="Xác nhận">
                <Check size={12} />
              </button>
              <button className="icon-btn-sm" onClick={() => setRenamingPath(null)} aria-label="Hủy">
                <X size={12} />
              </button>
            </div>
          ) : (
            <span className="ide-tree-label" title={node.path}>
              {node.name}
            </span>
          )}

          {!isRenaming && (
            <div className="ide-tree-actions" onClick={(e) => e.stopPropagation()}>
              {node.type === 'directory' && (
                <>
                  <button
                    className="icon-btn-sm"
                    aria-label="Tạo tệp con"
                    onClick={() => {
                      setCreatingParent(node.path);
                      setCreatingType('file');
                      setCreatingName('');
                    }}
                  >
                    <FilePlus size={12} />
                  </button>
                  <button
                    className="icon-btn-sm"
                    aria-label="Tạo thư mục con"
                    onClick={() => {
                      setCreatingParent(node.path);
                      setCreatingType('directory');
                      setCreatingName('');
                    }}
                  >
                    <FolderPlus size={12} />
                  </button>
                </>
              )}
              <button
                className="icon-btn-sm"
                aria-label="Đổi tên"
                onClick={() => {
                  setRenamingPath(node.path);
                  setRenamingName(node.name);
                }}
              >
                <Edit2 size={12} />
              </button>
              <button
                className="icon-btn-sm danger"
                aria-label="Xóa"
                onClick={() => setDeletingPath(node.path)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </div>

        {node.type === 'directory' && node.isExpanded && (
          <div className="ide-tree-children">
            {node.children && node.children.map((child) => renderNode(child, depth + 1))}
            {node.children && node.children.length === 0 && (
              <div
                className="ide-tree-empty-folder"
                style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
              >
                (thư mục rỗng)
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ide-file-tree">
      <div className="ide-panel-header">
        <span className="ide-panel-title">TẬP TIN DỰ ÁN</span>
        <div className="ide-panel-actions">
          <button
            className="icon-btn-sm"
            aria-label="Tệp mới"
            onClick={() => {
              setCreatingParent('');
              setCreatingType('file');
              setCreatingName('');
            }}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="icon-btn-sm"
            aria-label="Thư mục mới"
            onClick={() => {
              setCreatingParent('');
              setCreatingType('directory');
              setCreatingName('');
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn-sm"
            aria-label="Làm mới"
            onClick={refreshRoot}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {creatingType && creatingParent === '' && (
        <div className="ide-tree-inline-input root-creator">
          {creatingType === 'file' ? <File size={14} /> : <Folder size={14} />}
          <input
            autoFocus
            type="text"
            placeholder={creatingType === 'file' ? 'Tên tệp tin...' : 'Tên thư mục...'}
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateSubmit();
              if (e.key === 'Escape') setCreatingType(null);
            }}
          />
          <button className="icon-btn-sm" onClick={handleCreateSubmit} aria-label="Tạo">
            <Check size={12} />
          </button>
          <button className="icon-btn-sm" onClick={() => setCreatingType(null)} aria-label="Hủy">
            <X size={12} />
          </button>
        </div>
      )}

      {error && <div className="ide-error-banner">{error}</div>}

      <div className="ide-tree-scroll-container">
        {nodes.map((n) => renderNode(n, 0))}
        {nodes.length === 0 && !loading && (
          <div className="ide-empty-message">Không có tệp tin hoặc thư mục nào</div>
        )}
      </div>

      {deletingPath && (
        <ConfirmModal
          isOpen={true}
          title="Xác nhận xóa tệp / thư mục"
          message={`Bạn có chắc chắn muốn xóa vĩnh viễn: "${deletingPath}"? Thao tác này không thể hoàn tác.`}
          confirmText="Xóa vĩnh viễn"
          cancelText="Hủy"
          confirmVariant="danger"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingPath(null)}
        />
      )}
    </div>
  );
}
