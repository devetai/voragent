import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { Save, X, File, AlertCircle } from 'lucide-react';

export interface OpenFileTab {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  isBinary: boolean;
}

interface CodeEditorProps {
  tabs: OpenFileTab[];
  activePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onChangeContent: (path: string, newContent: string) => void;
  onSaveFile: (path: string) => void;
}

export function CodeEditor({
  tabs,
  activePath,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onSaveFile,
}: CodeEditorProps) {
  const currentTab = tabs.find((t) => t.path === activePath);

  const extensions = useMemo(() => {
    if (!currentTab) return [];
    const ext = currentTab.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return [javascript({ typescript: true, jsx: true })];
      case 'js':
      case 'jsx':
        return [javascript({ jsx: true })];
      case 'json':
        return [json()];
      case 'md':
      case 'markdown':
        return [markdown()];
      case 'html':
      case 'htm':
        return [html()];
      case 'css':
      case 'scss':
        return [css()];
      default:
        return [];
    }
  }, [currentTab?.name]);

  if (tabs.length === 0 || !currentTab) {
    return (
      <div className="ide-editor-empty-state">
        <div className="ide-editor-empty-icon">
          <File size={36} />
        </div>
        <div className="ide-editor-empty-title">VorStudio Lightweight Browser IDE</div>
        <div className="ide-editor-empty-desc">
          Chọn một tệp từ cây thư mục bên trái để bắt đầu xem và chỉnh sửa.
        </div>
        <div className="ide-editor-shortcuts">
          <div>
            <kbd>Ctrl + S</kbd> Lưu tệp tin
          </div>
          <div>
            <kbd>Ctrl + `</kbd> Bật / tắt Terminal
          </div>
          <div>
            <kbd>Ctrl + B</kbd> Thu gọn thanh bên
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ide-code-editor-container">
      {/* Tab bar */}
      <div className="ide-editor-tab-bar">
        <div className="ide-editor-tabs-scroll">
          {tabs.map((tab) => {
            const isActive = tab.path === activePath;
            return (
              <div
                key={tab.path}
                className={`ide-editor-tab ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTab(tab.path)}
              >
                <span className="ide-tab-name">{tab.name}</span>
                {tab.isDirty && <span className="ide-dirty-dot" data-tooltip="Chưa lưu" />}
                <button
                  className="ide-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  aria-label="Đóng tệp"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="ide-editor-toolbar-actions">
          {currentTab.isDirty && (
            <button
              className="ide-btn-save"
              onClick={() => onSaveFile(currentTab.path)}
            >
              <Save size={13} />
              <span>Lưu</span>
            </button>
          )}
        </div>
      </div>

      {/* Editor Body */}
      <div className="ide-editor-content-area">
        {currentTab.isBinary ? (
          <div className="ide-binary-viewer">
            <AlertCircle size={28} />
            <div>Tệp tin nhị phân không thể xem ở định dạng văn bản.</div>
            <div className="ide-binary-path">{currentTab.path}</div>
          </div>
        ) : (
          <CodeMirror
            value={currentTab.content}
            height="100%"
            theme="light"
            extensions={extensions}
            onChange={(val) => onChangeContent(currentTab.path, val)}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightSpecialChars: true,
              history: true,
              foldGutter: true,
              drawSelection: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              rectangularSelection: true,
              crosshairCursor: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              defaultKeymap: true,
              searchKeymap: true,
              historyKeymap: true,
              foldKeymap: true,
              completionKeymap: true,
              lintKeymap: true,
            }}
          />
        )}
      </div>
    </div>
  );
}
