import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  FileText,
  FolderGit2,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { PruneOptions, PruneResult, StorageStats } from '@voragent/shared';
import { api, errText } from './api';
import { SnakeLoader } from './components/SnakeLoader';
import { FolderPickerModal } from './components/FolderPickerModal';
import { ConfirmModal } from './components/ConfirmModal';
import { CustomSelect, type SelectOption } from './components/CustomSelect';

const OLDER_DAYS_OPTIONS: SelectOption<string>[] = [
  { value: '0', label: 'Tất cả task đã xong / lỗi' },
  { value: '3', label: 'Đã xong > 3 ngày trước' },
  { value: '7', label: 'Đã xong > 7 ngày trước' },
  { value: '30', label: 'Đã xong > 30 ngày trước' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i >= 2 ? 1 : 0)} ${sizes[i]}`;
}

export function SettingsView() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [showPickerModal, setShowPickerModal] = useState(false);
  const [confirmMigrate, setConfirmMigrate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Custom prune state
  const [olderDays, setOlderDays] = useState<number>(7);
  const [pruneEndedTasks, setPruneEndedTasks] = useState(true);
  const [pruneOrphans, setPruneOrphans] = useState(true);
  const [pruneLogs, setPruneLogs] = useState(true);
  const [pruneVacuum, setPruneVacuum] = useState(true);

  // Migration state
  const [newPath, setNewPath] = useState('');
  const [deleteOld, setDeleteOld] = useState(false);

  const loadStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.storage();
      setStats(data);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
  }, []);

  const handleBrowseFolder = () => {
    setShowPickerModal(true);
  };

  const handleQuickCleanup = async () => {
    try {
      setCleaning(true);
      setError(null);
      setSuccessMsg(null);
      const res: PruneResult = await api.prune({
        olderThanDays: 7,
        orphanWorktrees: true,
        logs: true,
        vacuum: true,
      });
      setSuccessMsg(
        `Dọn dẹp nhanh hoàn tất! Đã giải phóng ${formatBytes(res.freedBytes)} (${res.prunedWorktrees} task worktrees, ${res.prunedOrphans} orphan worktrees).`,
      );
      await loadStats();
    } catch (e) {
      setError(errText(e));
    } finally {
      setCleaning(false);
    }
  };

  const handleCustomPrune = async () => {
    try {
      setCleaning(true);
      setError(null);
      setSuccessMsg(null);
      const opts: PruneOptions = {
        olderThanDays: pruneEndedTasks ? olderDays : 999999,
        orphanWorktrees: pruneOrphans,
        logs: pruneLogs,
        vacuum: pruneVacuum,
      };
      const res = await api.prune(opts);
      setSuccessMsg(
        `Đã dọn dẹp thành công! Giải phóng ${formatBytes(res.freedBytes)} (${res.prunedWorktrees} task worktrees, ${res.prunedOrphans} orphan worktrees).`,
      );
      await loadStats();
    } catch (e) {
      setError(errText(e));
    } finally {
      setCleaning(false);
    }
  };

  const handleMigrate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) {
      setError('Vui lòng nhập đường dẫn thư mục đích.');
      return;
    }
    setError(null);
    setConfirmMigrate(true);
  };

  const executeMigration = async () => {
    try {
      setMigrating(true);
      setError(null);
      setSuccessMsg(null);
      const res = await api.migrate({ newPath: newPath.trim(), deleteOld });
      setSuccessMsg(
        `Di chuyển dữ liệu thành công sang: ${res.newPath}! File cấu hình khởi động (~/.voragentrc) đã được cập nhật. Hãy khởi động lại daemon khi thuận tiện để nhận diện hoàn toàn đường dẫn mới.`,
      );
      setNewPath('');
      await loadStats();
    } catch (err) {
      setError(errText(err));
    } finally {
      setMigrating(false);
      setConfirmMigrate(false);
    }
  };

  if (loading && !stats) {
    return (
      <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
        <SnakeLoader />
        <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Đang kiểm tra dung lượng lưu trữ...</p>
      </div>
    );
  }

  const breakdown = stats?.breakdown ?? { worktreesBytes: 0, databaseBytes: 0, logsBytes: 0, totalBytes: 0 };
  const disk = stats?.disk;
  const isDiskLow = disk && disk.freeBytes < 5 * 1024 * 1024 * 1024; // < 5GB

  // Tỉ lệ phần trăm các thành phần
  const total = Math.max(breakdown.totalBytes, 1);
  const wtPct = Math.round((breakdown.worktreesBytes / total) * 100);
  const dbPct = Math.round((breakdown.databaseBytes / total) * 100);
  const logPct = Math.min(100 - wtPct - dbPct, Math.round((breakdown.logsBytes / total) * 100));

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '1.5rem 1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Settings size={22} color="var(--amber-base)" /> Cài đặt & Quản lý dữ liệu
          </h1>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Kiểm soát vị trí thư mục .voragent, dọn dẹp dung lượng thừa và di chuyển dữ liệu sang ổ đĩa khác.
          </p>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void loadStats()}
          disabled={loading || cleaning || migrating}
          data-tooltip="Làm mới số liệu lưu trữ"
          data-tooltip-placement="bottom"
          aria-label="Làm mới số liệu lưu trữ"
          style={{ width: '32px', height: '32px', padding: 0 }}
        >
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="error banner" role="alert" style={{ marginBottom: '1.25rem' }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="notice banner" role="status" style={{ marginBottom: '1.25rem', backgroundColor: 'var(--green-bg)', borderColor: 'var(--green-border)', color: 'var(--green-text)' }}>
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 1. Storage Breakdown Card */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <HardDrive size={18} color="var(--blue-base)" />
            <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600 }}>Tình trạng lưu trữ</h2>
          </div>
          <span
            style={{
              fontSize: '0.8rem',
              padding: '0.2rem 0.6rem',
              borderRadius: 'var(--radius-full)',
              background: stats?.isCustomLocation ? 'var(--purple-bg)' : 'var(--bg-subtle)',
              color: stats?.isCustomLocation ? 'var(--purple-text)' : 'var(--text-secondary)',
              border: `1px solid ${stats?.isCustomLocation ? 'var(--purple-border)' : 'var(--border-subtle)'}`,
            }}
          >
            {stats?.isCustomLocation ? 'Đường dẫn tùy chỉnh (~/.voragentrc)' : 'Mặc định hệ thống (~/.voragent)'}
          </span>
        </div>

        {/* Current Path */}
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', wordBreak: 'break-all' }}>
          Vị trí hiện tại: <code style={{ backgroundColor: 'var(--bg-subtle)', padding: '0.2rem 0.4rem', borderRadius: '4px', color: 'var(--text-primary)' }}>{stats?.dataDir}</code>
        </div>

        {/* Disk Free Space Alert */}
        {disk && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.25rem',
              backgroundColor: isDiskLow ? 'var(--red-bg)' : 'var(--bg-subtle)',
              border: `1px solid ${isDiskLow ? 'var(--red-border)' : 'var(--border-subtle)'}`,
              color: isDiskLow ? 'var(--red-text)' : 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.875rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {isDiskLow ? <AlertTriangle size={16} /> : <HardDrive size={16} />}
              <span>
                Ổ đĩa chứa dữ liệu: Còn trống <strong>{formatBytes(disk.freeBytes)}</strong> / {formatBytes(disk.totalBytes)}
              </span>
            </div>
            {isDiskLow && <span style={{ fontWeight: 600 }}>Cảnh báo: Ổ đĩa sắp đầy!</span>}
          </div>
        )}

        {/* Visual Bar */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
            <span>Tổng dung lượng .voragent đang dùng: <strong>{formatBytes(breakdown.totalBytes)}</strong></span>
          </div>
          <div
            style={{
              display: 'flex',
              height: '14px',
              borderRadius: 'var(--radius-full)',
              overflow: 'hidden',
              backgroundColor: 'var(--bg-subtle)',
            }}
          >
            <div style={{ width: `${wtPct}%`, backgroundColor: 'var(--amber-base)' }} data-tooltip={`Worktrees: ${formatBytes(breakdown.worktreesBytes)}`} data-tooltip-placement="top" />
            <div style={{ width: `${dbPct}%`, backgroundColor: 'var(--green-base)' }} data-tooltip={`Database: ${formatBytes(breakdown.databaseBytes)}`} data-tooltip-placement="top" />
            <div style={{ width: `${logPct}%`, backgroundColor: 'var(--slate-base)' }} data-tooltip={`Logs: ${formatBytes(breakdown.logsBytes)}`} data-tooltip-placement="top" />
          </div>
        </div>

        {/* Breakdown Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--amber-base)' }} />
            <FolderGit2 size={14} color="var(--amber-base)" />
            <span>Worktrees task: <strong>{formatBytes(breakdown.worktreesBytes)}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--green-base)' }} />
            <Database size={14} color="var(--green-base)" />
            <span>Database (SQLite): <strong>{formatBytes(breakdown.databaseBytes)}</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--slate-base)' }} />
            <FileText size={14} color="var(--slate-base)" />
            <span>Nhật ký daemon: <strong>{formatBytes(breakdown.logsBytes)}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. Garbage Cleanup Section */}
      <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trash2 size={18} color="var(--amber-base)" />
            <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600 }}>Dọn dẹp rác & Giải phóng dung lượng</h2>
          </div>
        </div>

        {/* Quick 1-Click Banner */}
        <div
          style={{
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--amber-bg)',
            border: '1px solid var(--amber-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, color: 'var(--amber-text)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles size={16} /> Dọn dẹp nhanh 1-Click (Khuyến nghị)
            </div>
            <div style={{ fontSize: '0.825rem', color: 'var(--amber-text)', marginTop: '0.2rem' }}>
              Tự động xóa worktree của task đã xong &gt; 7 ngày, dọn sạch worktree mồ côi, thu gọn log và tối ưu database.
            </div>
          </div>
          <button
            className="primary"
            onClick={() => void handleQuickCleanup()}
            disabled={cleaning || migrating}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            {cleaning ? <SnakeLoader /> : <Sparkles size={15} />}
            <span>Dọn dẹp ngay</span>
          </button>
        </div>

        {/* Custom Prune Form */}
        <div style={{ backgroundColor: 'var(--bg-canvas)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.75rem' }}>Tùy chọn dọn dẹp chi tiết:</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={pruneEndedTasks}
                  onChange={(e) => setPruneEndedTasks(e.target.checked)}
                />
                <span>
                  Giải phóng worktrees của task đã kết thúc (Có sẵn {stats?.prunableWorktreesCount ?? 0} task):
                </span>
              </label>
              <div style={{ minWidth: '220px', maxWidth: '260px' }}>
                <CustomSelect
                  options={OLDER_DAYS_OPTIONS}
                  value={String(olderDays)}
                  onChange={(val) => setOlderDays(Number(val))}
                  disabled={!pruneEndedTasks}
                  searchable={false}
                />
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pruneOrphans}
                onChange={(e) => setPruneOrphans(e.target.checked)}
              />
              <span>Dọn dẹp worktrees mồ côi ({stats?.orphanWorktreesCount ?? 0} thư mục thừa không thuộc task nào)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pruneLogs}
                onChange={(e) => setPruneLogs(e.target.checked)}
              />
              <span>Thu gọn file nhật ký daemon.log (hiện tại: {formatBytes(breakdown.logsBytes)})</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={pruneVacuum}
                onChange={(e) => setPruneVacuum(e.target.checked)}
              />
              <span>Tối ưu hóa dung lượng cơ sở dữ liệu (SQLite VACUUM)</span>
            </label>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => void handleCustomPrune()}
              disabled={cleaning || migrating || (!pruneEndedTasks && !pruneOrphans && !pruneLogs && !pruneVacuum)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <Trash2 size={14} /> Thực hiện dọn dẹp đã chọn
            </button>
          </div>
        </div>

        {/* Safety Note */}
        <p style={{ margin: '1rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          * <strong>Bảo toàn dữ liệu:</strong> Khi dọn dẹp worktrees, voragent chỉ xóa thư mục checkout mã nguồn tạm trên ổ đĩa. Toàn bộ lịch sử chat, tin nhắn, diff, và checkpoints vẫn được lưu giữ 100% trong cơ sở dữ liệu.
        </p>
      </div>

      {/* 3. Data Location & Migration Section */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <HardDrive size={18} color="var(--purple-base)" />
          <h2 style={{ fontSize: '1.1rem', margin: 0, fontWeight: 600 }}>Di chuyển vị trí lưu trữ .voragent (Migration)</h2>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
          Nếu ổ đĩa C của bạn sắp hết dung lượng, bạn có thể chuyển toàn bộ thư mục dữ liệu `.voragent` sang ổ đĩa khác (ví dụ: ổ <code>D:\voragent_data</code>). Quá trình di chuyển sẽ sao chép Database, Logs và tự động sửa các liên kết Git Worktrees mà không làm hỏng repo gốc.
        </p>

        <form onSubmit={handleMigrate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>
              Đường dẫn thư mục mới (Đường dẫn tuyệt đối trên ổ khác):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="Ví dụ: D:\voragent_data hoặc E:\voragent"
                disabled={migrating || cleaning}
                style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.9rem', borderRadius: 'var(--radius-sm)' }}
              />
              <button
                type="button"
                onClick={handleBrowseFolder}
                disabled={migrating || cleaning}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap', padding: '0.5rem 0.85rem' }}
                data-tooltip="Mở trình duyệt thư mục trên máy" data-tooltip-placement="top" aria-label="Mở trình duyệt thư mục"
              >
                <FolderOpen size={16} />
                <span>Duyệt thư mục...</span>
              </button>
            </div>

            {/* Quick Drive Suggestions */}
            {stats?.availableDrives && stats.availableDrives.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gợi ý nhanh:</span>
                {stats.availableDrives.map((d) => {
                  const targetFolder = `${d.drive}\\voragent_data`;
                  return (
                    <button
                      key={d.drive}
                      type="button"
                      onClick={() => setNewPath(targetFolder)}
                      style={{
                        padding: '0.2rem 0.6rem',
                        fontSize: '0.775rem',
                        borderRadius: 'var(--radius-full)',
                        backgroundColor: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                      }}
                      data-tooltip={`Điền đường dẫn thư mục trên ổ ${d.drive}`} data-tooltip-placement="top"
                    >
                      <strong>{targetFolder}</strong> ({formatBytes(d.freeBytes)} trống)
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={deleteOld}
              onChange={(e) => setDeleteOld(e.target.checked)}
              disabled={migrating || cleaning}
            />
            <span>Tự động dọn dẹp thư mục cũ sau khi sao chép và xác thực thành công</span>
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="submit"
              className="primary"
              disabled={migrating || cleaning || !newPath.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {migrating ? <SnakeLoader /> : <HardDrive size={15} />}
              <span>{migrating ? 'Đang di chuyển dữ liệu...' : 'Bắt đầu di chuyển dữ liệu'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Modal xác nhận di chuyển (Rule 15: Zero native confirm) */}
      <ConfirmModal
        isOpen={confirmMigrate}
        title="Xác nhận di chuyển vị trí lưu trữ .voragent"
        confirmText="Bắt đầu di chuyển"
        confirmVariant="primary"
        icon="warning"
        isLoading={migrating}
        message={
          <div>
            <p style={{ margin: '0 0 0.5rem' }}>
              Bạn có chắc chắn muốn di chuyển toàn bộ thư mục dữ liệu <code>.voragent</code> sang:
            </p>
            <div
              style={{
                backgroundColor: 'var(--bg-subtle)',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                wordBreak: 'break-all',
                marginBottom: '0.75rem',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {newPath.trim()}
            </div>
            <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
              Quá trình này sẽ sao chép toàn bộ Cơ sở dữ liệu SQLite, file Logs và tự động sửa các liên kết Git worktrees mà không làm mất lịch sử hay làm hỏng repository gốc.
            </p>
          </div>
        }
        onConfirm={executeMigration}
        onCancel={() => setConfirmMigrate(false)}
      />

      {/* Inline Folder Picker Modal */}
      {showPickerModal && (
        <FolderPickerModal
          initialPath={newPath || undefined}
          onSelect={(selected) => {
            setNewPath(selected);
            setShowPickerModal(false);
          }}
          onClose={() => setShowPickerModal(false)}
        />
      )}
    </div>
  );
}
