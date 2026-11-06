import React, { useEffect, useState } from 'react';
import { X, Plus, Minus, Undo2, GitCommit, FileCode } from 'lucide-react';
import { api, errText } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';

interface DiffViewerProps {
  cwd: string;
  filePath: string;
  staged: boolean;
  onClose: () => void;
  onRefreshGit: () => void;
}

export function DiffViewer({ cwd, filePath, staged, onClose, onRefreshGit }: DiffViewerProps) {
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchDiff = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.ideGitDiff(cwd, filePath, staged);
        if (active) setDiff(res.diff);
      } catch (e) {
        if (active) setError(errText(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchDiff();
    return () => {
      active = false;
    };
  }, [cwd, filePath, staged]);

  const handleStage = async () => {
    try {
      await api.ideGitStage(cwd, [filePath]);
      onRefreshGit();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const handleUnstage = async () => {
    try {
      await api.ideGitUnstage(cwd, [filePath]);
      onRefreshGit();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const handleDiscard = async () => {
    try {
      await api.ideGitDiscard(cwd, [filePath]);
      setShowDiscardConfirm(false);
      onRefreshGit();
      onClose();
    } catch (e) {
      setError(errText(e));
    }
  };

  const renderDiffLines = () => {
    if (!diff.trim()) {
      return <div className="ide-diff-empty">Không có thay đổi nào trên tệp này</div>;
    }

    const lines = diff.split('\n');
    let oldLine = 0;
    let newLine = 0;

    return (
      <div className="ide-diff-content">
        {lines.map((line, idx) => {
          let type = 'context';
          if (line.startsWith('@@')) {
            type = 'hunk';
            const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
            if (match) {
              oldLine = parseInt(match[1] || '0', 10) - 1;
              newLine = parseInt(match[2] || '0', 10) - 1;
            }
          } else if (line.startsWith('+') && !line.startsWith('+++')) {
            type = 'addition';
            newLine++;
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            type = 'deletion';
            oldLine++;
          } else if (line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
            type = 'header';
          } else {
            oldLine++;
            newLine++;
          }

          return (
            <div key={idx} className={`ide-diff-line ${type}`}>
              <span className="ide-diff-num old-num">
                {type === 'addition' || type === 'header' || type === 'hunk' ? '' : oldLine}
              </span>
              <span className="ide-diff-num new-num">
                {type === 'deletion' || type === 'header' || type === 'hunk' ? '' : newLine}
              </span>
              <span className="ide-diff-prefix">
                {type === 'addition' ? '+' : type === 'deletion' ? '-' : ' '}
              </span>
              <span className="ide-diff-text">{line}</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="ide-diff-viewer">
      <div className="ide-diff-header">
        <div className="ide-diff-title">
          <FileCode size={15} />
          <span className="ide-diff-file-name">{filePath}</span>
          <span className={`ide-diff-status-tag ${staged ? 'staged' : 'working'}`}>
            {staged ? 'Đã stage' : 'Chưa stage'}
          </span>
        </div>

        <div className="ide-diff-actions">
          {staged ? (
            <button className="ide-btn-secondary" onClick={handleUnstage}>
              <Minus size={13} />
              <span>Bỏ stage</span>
            </button>
          ) : (
            <>
              <button className="ide-btn-primary" onClick={handleStage}>
                <Plus size={13} />
                <span>Stage</span>
              </button>
              <button
                className="ide-btn-danger"
                onClick={() => setShowDiscardConfirm(true)}
              >
                <Undo2 size={13} />
                <span>Hủy thay đổi</span>
              </button>
            </>
          )}
          <button className="icon-btn-sm" onClick={onClose} aria-label="Đóng xem diff">
            <X size={15} />
          </button>
        </div>
      </div>

      {error && <div className="ide-error-banner">{error}</div>}

      <div className="ide-diff-body">
        {loading ? <div className="ide-loading-spinner">Đang tải Git diff...</div> : renderDiffLines()}
      </div>

      {showDiscardConfirm && (
        <ConfirmModal
          isOpen={true}
          title="Hủy bỏ thay đổi tệp"
          message={`Bạn có chắc muốn hủy bỏ toàn bộ sửa đổi trên tệp "${filePath}"?`}
          confirmText="Hủy bỏ thay đổi"
          cancelText="Giữ lại"
          confirmVariant="danger"
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardConfirm(false)}
        />
      )}
    </div>
  );
}
