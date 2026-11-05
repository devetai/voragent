import { useMemo, useState } from 'react';
import { Brain, Pin, Plus, Trash2, User, X } from 'lucide-react';
import type { MemoryCategory, MemoryItem, ProviderState } from '@voragent/shared';
import { MEMORY_CATEGORY_LABEL } from '@voragent/shared';
import { api, errText } from './api';
import { CustomSelect, type SelectOption } from './components/CustomSelect';
import { TimeBadge } from './components/TimeBadge';
import { ProviderIcon } from './components/ProviderIcon';
import { MarkdownContent } from './components/MarkdownContent';
import { ConfirmModal } from './components/ConfirmModal';
import { isProviderInstalledById } from './state';

const CATEGORIES: MemoryCategory[] = ['architecture', 'decision', 'context', 'finding'];

const CATEGORY_OPTIONS: SelectOption<MemoryCategory>[] = CATEGORIES.map((c) => ({
  value: c,
  label: MEMORY_CATEGORY_LABEL[c],
}));

const BASE_PROVIDER_AUTHORS = [
  { value: 'claude', label: 'Claude Code' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'codex', label: 'Codex' },
];

export function SharedMemoryPanel({
  repoPath,
  projectName,
  memories,
  providers = [],
  defaultAuthor = 'user',
  onChanged,
  onClose,
}: {
  repoPath: string | null;
  projectName: string;
  memories: MemoryItem[];
  providers?: ProviderState[];
  defaultAuthor?: string;
  onChanged: () => void;
  onClose?: () => void;
}) {
  // Chỉ hiển thị các Agent ĐÃ CÀI ĐẶT trong danh sách "Người ghi nhận" (không hiện các CLI chưa khả dụng như Codex khi chưa cài)
  const authorOptions = useMemo<SelectOption[]>(() => {
    const installedProviders = BASE_PROVIDER_AUTHORS
      .filter((p) => isProviderInstalledById(providers, p.value))
      .map((p) => ({
        value: p.value,
        label: p.label,
        icon: <ProviderIcon provider={p.value} size={13} />,
      }));

    return [
      { value: 'user', label: 'Người dùng (User)', icon: <User size={13} /> },
      { value: 'manager', label: 'Trưởng phòng (Lead)', icon: <ProviderIcon provider="manager" size={13} /> },
      ...installedProviders,
    ];
  }, [providers]);

  const validDefaultAuthor = authorOptions.some((o) => o.value === defaultAuthor) ? defaultAuthor : 'user';

  const [filterCat, setFilterCat] = useState<MemoryCategory | 'all'>('all');
  const [category, setCategory] = useState<MemoryCategory>('architecture');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [author, setAuthor] = useState(validDefaultAuthor);
  const [pinned, setPinned] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState<MemoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(memories.length === 0);

  const filtered = filterCat === 'all'
    ? memories
    : memories.filter((m) => m.category === filterCat);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath) {
      setError('Vui lòng chọn một Văn phòng Dự án trước khi lưu vào Shared Memory.');
      return;
    }
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const effectiveAuthor = authorOptions.some((o) => o.value === author) ? author : 'user';
      await api.saveMemory({
        repoPath,
        category,
        title: title.trim(),
        content: content.trim(),
        author: effectiveAuthor,
        pinned,
      });
      setTitle('');
      setContent('');
      setShowForm(false);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (item: MemoryItem) => {
    try {
      await api.saveMemory({
        id: item.id,
        repoPath: item.repoPath,
        category: item.category,
        title: item.title,
        content: item.content,
        author: item.author,
        pinned: !item.pinned,
      });
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  };

  const handleConfirmDelete = async () => {
    if (!memoryToDelete) return;
    setDeleting(true);
    try {
      await api.deleteMemory(memoryToDelete.id);
      setMemoryToDelete(null);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setDeleting(false);
    }
  };

  const installedNames = BASE_PROVIDER_AUTHORS
    .filter((p) => isProviderInstalledById(providers, p.value))
    .map((p) => p.label)
    .join(', ');

  return (
    <div className="office-side-panel">
      <div className="office-side-header">
        <div>
          <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Brain size={17} /> Bộ Nhớ Chung Văn Phòng (Shared Memory)
          </h3>
          <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>
            Văn phòng: <strong>{projectName || 'Tất cả dự án'}</strong> · Tự động tiêm vào mọi lượt chạy của {installedNames || 'các Agent khả dụng'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {repoPath && (
            <button
              type="button"
              className="primary"
              style={{ fontSize: '12px', padding: '5px 10px', height: '32px', minHeight: '32px' }}
              onClick={() => setShowForm(!showForm)}
            >
              {showForm ? 'Ẩn form' : <><Plus size={14} /> Thêm ghi nhớ</>}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="icon-btn-sm"
              onClick={onClose}
              title="Đóng cửa sổ (Esc)"
              aria-label="Đóng cửa sổ"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {error && <div className="error" role="alert" style={{ margin: '8px 0' }}>{error}</div>}

      {/* Form thêm mới vào Shared Memory */}
      {showForm && repoPath && (
        <form onSubmit={(e) => { void handleSave(e); }} className="office-memory-form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px' }}>
                Phân loại tri thức
              </label>
              <CustomSelect
                options={CATEGORY_OPTIONS}
                value={category}
                onChange={(val) => setCategory(val)}
                searchable={false}
              />
            </div>
            <div>
              <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px' }}>
                Người ghi nhận
              </label>
              <CustomSelect
                options={authorOptions}
                value={author}
                onChange={(val) => setAuthor(val)}
                searchable={false}
              />
            </div>
          </div>

          <div style={{ marginTop: '8px' }}>
            <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px' }}>
              Tiêu đề ngắn gọn
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VD: Quy ước dùng SQLite WAL & không sửa trực tiếp nhánh main"
              required
            />
          </div>

          <div style={{ marginTop: '8px' }}>
            <label className="form-label" style={{ fontSize: '12px', marginBottom: '4px' }}>
              Nội dung chi tiết (hỗ trợ Markdown, sẽ chia sẻ cho mọi agent trong văn phòng)
            </label>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Nhập kiến trúc, quyết định chung, API contract hoặc lưu ý quan trọng (hỗ trợ Markdown)..."
              required
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', cursor: 'pointer', userSelect: 'none' }}>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <span>📌 Ghim lên Bảng Trắng 3D của Văn phòng</span>
            </label>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Đang lưu…' : 'Lưu vào Shared Memory'}
            </button>
          </div>
        </form>
      )}

      {/* Bộ lọc danh mục */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '10px 0' }}>
        <button
          type="button"
          className={filterCat === 'all' ? 'primary' : ''}
          style={{ fontSize: '12px', padding: '4px 10px', height: '30px', minHeight: '30px' }}
          onClick={() => setFilterCat('all')}
        >
          Tất cả ({memories.length})
        </button>
        {CATEGORIES.map((c) => {
          const count = memories.filter((m) => m.category === c).length;
          return (
            <button
              key={c}
              type="button"
              className={filterCat === c ? 'primary' : ''}
              style={{ fontSize: '12px', padding: '4px 10px', height: '30px', minHeight: '30px' }}
              onClick={() => setFilterCat(c)}
            >
              {MEMORY_CATEGORY_LABEL[c]} ({count})
            </button>
          );
        })}
      </div>

      {/* Danh sách các mục trong Shared Memory */}
      <div className="office-side-scroll">
        {filtered.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: '24px 12px', background: 'var(--bg-subtle)', borderRadius: '8px' }}>
            Chưa có mục nhớ nào trong phân mục này. Khi Trưởng phòng lập kế hoạch, Sub-agent báo cáo xong, hoặc bạn thêm quy ước, mọi Agent trong văn phòng sẽ đọc chung tại đây.
          </div>
        ) : (
          filtered.map((m) => (
            <div key={m.id} className={`office-memory-card ${m.pinned ? 'pinned' : ''}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                <div>
                  <span className="badge neutral" style={{ marginRight: '6px' }}>
                    {MEMORY_CATEGORY_LABEL[m.category] ?? m.category}
                  </span>
                  <strong style={{ fontSize: '13.5px' }}>{m.title}</strong>
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    type="button"
                    className={`icon-btn-sm ${m.pinned ? 'active' : ''}`}
                    onClick={() => { void handleTogglePin(m); }}
                    title={m.pinned ? 'Đang ghim trên Bảng Trắng 3D — Bấm để bỏ ghim' : 'Ghim mục nhớ này lên Bảng Trắng 3D'}
                    aria-label={m.pinned ? 'Bỏ ghim' : 'Ghim lên bảng 3D'}
                  >
                    <Pin size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn-sm danger"
                    onClick={() => setMemoryToDelete(m)}
                    title="Xóa mục nhớ này"
                    aria-label="Xóa mục nhớ"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div style={{ marginTop: '6px' }}>
                <MarkdownContent content={m.content} compact />
              </div>
              <div className="muted" style={{ fontSize: '11px', marginTop: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  Ghi bởi:
                  {m.author !== 'user' && <ProviderIcon provider={m.author} size={11} />}
                  <strong>{m.author.toUpperCase()}</strong>
                </span>
                <TimeBadge timestamp={m.updatedAt} />
              </div>
            </div>
          ))
        )}
      </div>
      <ConfirmModal
        isOpen={memoryToDelete !== null}
        title="Xóa mục ghi nhớ chung?"
        message={
          memoryToDelete ? (
            <span>
              Bạn có chắc chắn muốn xóa mục ghi nhớ <strong>"{memoryToDelete.title}"</strong> không? Ngữ cảnh này sẽ không còn được chia sẻ tới các Agent.
            </span>
          ) : ''
        }
        confirmText="Xác nhận xóa"
        cancelText="Giữ lại"
        confirmVariant="danger"
        isLoading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setMemoryToDelete(null)}
      />
    </div>
  );
}
