import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TerminalIcon, Plus, X, Trash2, RotateCw } from 'lucide-react';

interface TerminalTab {
  id: string;
  name: string;
}

interface WebTerminalProps {
  cwd: string;
  onCloseDrawer?: () => void;
}

export function WebTerminal({ cwd, onCloseDrawer }: WebTerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: 'term-1', name: 'Terminal 1' },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('term-1');

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Khởi tạo terminal instance & socket
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Tạo instance xterm
    const term = new Terminal({
      theme: {
        background: '#1F1B18', // Warm espresso
        foreground: '#F5EFE6', // Soft cream
        cursor: '#D97757', // Terracotta
        selectionBackground: 'rgba(217, 119, 87, 0.35)',
        black: '#1F1B18',
        red: '#EF4444',
        green: '#10B981',
        yellow: '#F59E0B',
        blue: '#3B82F6',
        magenta: '#EC4899',
        cyan: '#06B6D4',
        white: '#F5EFE6',
      },
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Dọn sạch container trước khi gắn
    containerRef.current.innerHTML = '';
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 2. Mở kết nối WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams(window.location.search);
    const key = params.get('key');
    let wsUrl = `${protocol}//${window.location.host}/api/terminal/ws?cwd=${encodeURIComponent(cwd)}`;
    if (key) wsUrl += `&key=${encodeURIComponent(key)}`;
    wsUrl += `&cols=${term.cols}&rows=${term.rows}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      term.writeln('\x1b[38;5;214m● Đã kết nối Web Terminal voragent\x1b[0m');
      term.writeln(`\x1b[90mThư mục làm việc: ${cwd}\x1b[0m\r\n`);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[90m[Tiến trình đã thoát với mã ${msg.code}]\x1b[0m\r\n`);
        }
      } catch {
        term.write(ev.data);
      }
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[Lỗi kết nối WebSocket Terminal]\x1b[0m\r\n');
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[90m[Đã đóng phiên Terminal]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize observer
    const handleResize = () => {
      try {
        fitAddon.fit();
      } catch {
        // ignore
      }
    };
    window.addEventListener('resize', handleResize);

    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [cwd, activeTabId]);

  const handleAddTab = () => {
    const nextIdx = tabs.length + 1;
    const newTab: TerminalTab = {
      id: `term-${Date.now()}`,
      name: `Terminal ${nextIdx}`,
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      if (onCloseDrawer) onCloseDrawer();
      return;
    }
    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0]?.id || '');
    }
  };

  const handleClear = () => {
    termRef.current?.clear();
  };

  return (
    <div className="ide-web-terminal-container">
      {/* Terminal tab header */}
      <div className="ide-terminal-header">
        <div className="ide-terminal-tabs">
          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`ide-terminal-tab ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                <TerminalIcon size={13} />
                <span>{tab.name}</span>
                <button
                  className="ide-terminal-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  aria-label="Đóng terminal"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button className="ide-terminal-btn-add" onClick={handleAddTab} aria-label="Terminal mới">
            <Plus size={13} />
          </button>
        </div>

        <div className="ide-terminal-actions">
          <button className="ide-terminal-action-btn" onClick={handleClear} aria-label="Xóa màn hình">
            <Trash2 size={13} />
          </button>
          {onCloseDrawer && (
            <button className="ide-terminal-action-btn" onClick={onCloseDrawer} aria-label="Đóng Terminal">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Terminal viewport */}
      <div className="ide-terminal-viewport" ref={containerRef} />
    </div>
  );
}
