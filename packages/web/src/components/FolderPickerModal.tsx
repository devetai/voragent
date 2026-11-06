import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  HardDrive,
  Search,
  X,
} from 'lucide-react';
import type { BrowseFolderResult, FolderEntry } from '@voragent/shared';
import { api, errText } from '../api';
import { SnakeLoader } from './SnakeLoader';

interface FolderPickerModalProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPickerModal({ initialPath, onSelect, onClose }: FolderPickerModalProps) {
  const [data, setData] = useState<BrowseFolderResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string>(initialPath || '');
  const [filterQuery, setFilterQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const loadPath = async (targetPath?: string | null) => {
    try {
      setLoading(true);
      setError(null);
      setFilterQuery('');
      setCreating(false);
      setNewFolderName('');
      const res = await api.browseFolders(targetPath);
      setData(res);
      if (res.currentPath) {
        setSelectedPath(res.currentPath);
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPath(initialPath || null);
  }, [initialPath]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !data?.currentPath) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.createFolder(data.currentPath, newFolderName.trim());
      setSelectedPath(res.path);
      await loadPath(data.currentPath);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  const filteredFolders = (data?.folders ?? []).filter((f) =>
    f.name.toLowerCase().includes(filterQuery.toLowerCase()),
  );

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(31, 27, 24, 0.45)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: '620px',
          maxWidth: '96vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-canvas)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FolderOpen size={18} color="var(--amber-base)" />
            <span style={{ fontWeight: 600, fontSize: '1rem' }}>Duyệt thư mục trên máy</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Đóng"



            style={{ width: '28px', height: '28px', padding: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Current Path Bar & Parent Navigation */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-surface)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <button
            type="button"
            onClick={() => void loadPath(data?.parentPath ?? null)}
            disabled={!data?.parentPath && data?.isRoot}
            style={{
              padding: '0.35rem 0.65rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.825rem',
            }}
            data-tooltip="Lên thư mục cha" data-tooltip-placement="bottom" aria-label="Lên thư mục cha"
          >
            <FolderUp size={15} />
            <span>Lên</span>
          </button>

          <button
            type="button"
            onClick={() => void loadPath(null)}
            style={{
              padding: '0.35rem 0.65rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              fontSize: '0.825rem',
            }}
            data-tooltip="Danh sách ổ đĩa" data-tooltip-placement="bottom" aria-label="Danh sách ổ đĩa"
          >
            <HardDrive size={15} />
            <span>Ổ đĩa</span>
          </button>

          <div
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              backgroundColor: 'var(--bg-subtle)',
              padding: '0.35rem 0.65rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-primary)',
            }}
          >
            {data?.currentPath || 'Chọn ổ đĩa máy tính:'}
          </div>
        </div>

        {/* Search & New Folder Toolbar */}
        <div
          style={{
            padding: '0.5rem 1.25rem',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
          <div style={{ position: 'relative', flex: 1 }}>
            <Search
              size={14}
              style={{
                position: 'absolute',
                left: '0.6rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              placeholder="Tìm kiếm thư mục..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.35rem 0.5rem 0.35rem 1.8rem',
                fontSize: '0.825rem',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          </div>

          {data?.currentPath && (
            <button
              type="button"
              onClick={() => setCreating(!creating)}
              style={{
                padding: '0.35rem 0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.825rem',
              }}
            >
              <FolderPlus size={15} color="var(--amber-base)" />
              <span>Thư mục mới</span>
            </button>
          )}
        </div>

        {/* Create Folder Inline Form */}
        {creating && (
          <form
            onSubmit={handleCreateFolder}
            style={{
              padding: '0.5rem 1.25rem',
              backgroundColor: 'var(--amber-bg)',
              borderBottom: '1px solid var(--amber-border)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <input
              type="text"
              placeholder="Nhập tên thư mục mới..."
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              style={{
                flex: 1,
                padding: '0.35rem 0.65rem',
                fontSize: '0.85rem',
                borderRadius: 'var(--radius-sm)',
              }}
            />
            <button
              type="submit"
              className="primary"
              disabled={!newFolderName.trim() || loading}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.825rem' }}
            >
              Tạo
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              style={{ padding: '0.35rem 0.75rem', fontSize: '0.825rem' }}
            >
              Hủy
            </button>
          </form>
        )}

        {/* Error Message */}
        {error && (
          <div style={{ padding: '0.5rem 1.25rem', color: 'var(--red-text)', backgroundColor: 'var(--red-bg)', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {/* Folders List */}
        <div
          style={{
            flex: 1,
            minHeight: '260px',
            maxHeight: '340px',
            overflowY: 'auto',
            padding: '0.5rem',
          }}
        >
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <SnakeLoader />
              <p style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Đang quét thư mục...
              </p>
            </div>
          ) : filteredFolders.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {filterQuery ? 'Không tìm thấy thư mục nào phù hợp.' : 'Thư mục này trống (không có thư mục con).'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
              {filteredFolders.map((item) => {
                const isSelected = selectedPath.toLowerCase() === item.path.toLowerCase();
                const isDrive = !data?.currentPath;
                return (
                  <div
                    key={item.path}
                    onClick={() => setSelectedPath(item.path)}
                    onDoubleClick={() => void loadPath(item.path)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.45rem 0.75rem',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'var(--amber-bg)' : 'transparent',
                      border: `1px solid ${isSelected ? 'var(--amber-border)' : 'transparent'}`,
                      transition: 'background-color 0.1s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      {isDrive ? (
                        <HardDrive size={16} color="var(--blue-base)" />
                      ) : (
                        <Folder size={16} color="var(--amber-base)" />
                      )}
                      <span style={{ fontSize: '0.875rem', fontWeight: isSelected ? 600 : 400 }}>
                        {item.name}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void loadPath(item.path);
                      }}
                      style={{
                        padding: '0.2rem 0.5rem',
                        fontSize: '0.75rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                      }}
                      data-tooltip="Mở thư mục này" data-tooltip-placement="left" aria-label="Mở thư mục"
                    >
                      <span>Mở</span>
                      <ChevronRight size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            borderTop: '1px solid var(--border-subtle)',
            backgroundColor: 'var(--bg-canvas)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.825rem' }}>
            Đã chọn: <strong style={{ color: 'var(--amber-text)' }}>{selectedPath || '(Chưa chọn)'}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button type="button" onClick={onClose} style={{ fontSize: '0.85rem' }}>
              Hủy
            </button>
            <button
              type="button"
              className="primary"
              disabled={!selectedPath || selectedPath.endsWith(':\\') && !data?.currentPath}
              onClick={() => {
                if (selectedPath) {
                  onSelect(selectedPath);
                  onClose();
                }
              }}
              style={{ fontSize: '0.85rem' }}
            >
              Chọn thư mục này
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
