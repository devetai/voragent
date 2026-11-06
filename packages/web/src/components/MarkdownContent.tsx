import React, { useState } from 'react';
import { Check, Copy, ExternalLink, Terminal } from 'lucide-react';

/**
 * Loại bỏ cú pháp Markdown thô để hiển thị văn bản thuần gọn gàng trên thẻ tóm tắt / 3D sticky note.
 */
export function stripMarkdown(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/```[\s\S]*?```/g, '[Mã nguồn]')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^>\s+/gm, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s+/gm, '• ')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/\n{2,}/g, ' · ')
    .trim();
}


const COMMAND_PREFIXES = [
  'npm ', 'pnpm ', 'yarn ', 'npx ', 'node ', 'python ', 'python3 ', 'git ',
  'cargo ', 'deno ', 'bun ', 'cd ', 'eval ', 'fnm ', 'agy ', 'claude ', 'codex ', 'opencode ', 'serve ',
];

function isCommandLine(str: string): boolean {
  const trimmed = str.trim();
  return COMMAND_PREFIXES.some((prefix) => trimmed.startsWith(prefix)) ||
    /^(npm|pnpm|yarn|npx|node|python|git|deno|bun|agy|claude|codex|opencode)(.exe)?(\s|$)/i.test(trimmed);
}

function isUrl(str: string): boolean {
  return /^(https?:\/\/|file:\/\/\/)/i.test(str.trim());
}

function CommandInlineChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <span
      className="md-command-chip"
      onClick={handleCopy}
      data-tooltip={copied ? 'Đã sao chép lệnh!' : 'Sao chép lệnh'}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }
      }}
    >
      <Terminal size={11} className="md-command-chip-icon" />
      <code className="md-command-chip-code">{code}</code>
      <span className="md-command-chip-btn">
        {copied ? <Check size={11} color="var(--green-base)" /> : <Copy size={11} />}
      </span>
      {copied && <span className="md-command-chip-copied">Đã chép!</span>}
    </span>
  );
}

function UrlInlineChip({ url, label }: { url: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const isLocalFile = url.startsWith('file:///');

  return (
    <span className="md-url-chip">
      <a
        href={url}
        target={isLocalFile ? undefined : '_blank'}
        rel={isLocalFile ? undefined : 'noreferrer noopener'}
        className="md-url-link"
        data-tooltip={url}
      >
        <ExternalLink size={11} />
        <span>{label ?? url}</span>
      </a>
      <button
        type="button"
        className="md-url-copy-btn"
        onClick={handleCopy}
        data-tooltip={copied ? 'Đã sao chép URL!' : 'Sao chép URL'}
        aria-label="Sao chép URL"
      >
        {copied ? <Check size={11} color="var(--green-base)" /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          className="copy-btn"
          onClick={handleCopy}
          data-tooltip={copied ? 'Đã sao chép mã nguồn' : 'Sao chép mã nguồn'}
          aria-label="Sao chép mã nguồn"
        >
          {copied ? <Check size={11} color="var(--green-base)" /> : <Copy size={11} />}
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Phân tích định dạng inline: `code`, **bold**, *italic*, ~~strike~~, [link](url)
 */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*|https?:\/\/[^\s<>)"]+|file:\/\/\/[^\s<>)"]+)/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let k = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      const code = token.slice(1, -1);
      if (isCommandLine(code)) {
        nodes.push(<CommandInlineChip key={`cmd-${k++}`} code={code} />);
      } else if (isUrl(code)) {
        nodes.push(<UrlInlineChip key={`u-${k++}`} url={code} />);
      } else {
        nodes.push(
          <code key={`ic-${k++}`} className="md-inline-code">
            {code}
          </code>,
        );
      }
    } else if (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('file:///')) {
      nodes.push(<UrlInlineChip key={`u-${k++}`} url={token} />);
    } else if (
      (token.startsWith('**') && token.endsWith('**')) ||
      (token.startsWith('__') && token.endsWith('__'))
    ) {
      nodes.push(<strong key={`b-${k++}`}>{renderInline(token.slice(2, -2))}</strong>);
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      nodes.push(<del key={`s-${k++}`}>{renderInline(token.slice(2, -2))}</del>);
    } else if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const splitIdx = token.indexOf('](');
      const label = token.slice(1, splitIdx);
      const href = token.slice(splitIdx + 2, -1);
      const safeHref = /^(https?:\/\/|file:\/\/\/|mailto:|\/|#)/i.test(href) ? href : '#';
      if (safeHref.startsWith('http') || safeHref.startsWith('file:///')) {
        nodes.push(<UrlInlineChip key={`a-${k++}`} url={safeHref} label={label} />);
      } else {
        nodes.push(
          <a
            key={`a-${k++}`}
            href={safeHref}
            className="md-link"
          >
            {label}
          </a>,
        );
      }
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={`i-${k++}`}>{renderInline(token.slice(1, -1))}</em>);
    } else {
      nodes.push(token);
    }
    lastIdx = match.index + token.length;
  }

  if (lastIdx < text.length) {
    nodes.push(text.slice(lastIdx));
  }

  return nodes;
}

/**
 * Component hiển thị Markdown chuẩn GitHub-Flavored Markdown (GFM) cho toàn bộ UI voragent.
 * Hỗ trợ tiêu đề, danh sách, checklist, bảng, trích dẫn, khối mã nguồn có nút copy và định dạng inline.
 */
export function MarkdownContent({
  content,
  compact = false,
  className = '',
}: {
  content: string;
  compact?: boolean;
  className?: string;
}) {
  if (!content) return null;

  // Tách khối fenced code blocks (```lang ... ```) trước
  const segments = content.split(/(```[\s\S]*?```)/g);
  const blocks: React.ReactNode[] = [];

  segments.forEach((seg, segIdx) => {
    if (seg.startsWith('```') && seg.endsWith('```')) {
      const firstNewline = seg.indexOf('\n');
      const lang = firstNewline > 3 ? seg.slice(3, firstNewline).trim() : '';
      const code =
        firstNewline >= 0
          ? seg.slice(firstNewline + 1, -3).replace(/\n$/, '')
          : seg.slice(3, -3);
      blocks.push(<CodeBlock key={`cb-${segIdx}`} lang={lang} code={code} />);
      return;
    }

    const lines = seg.replace(/\r\n/g, '\n').split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (trimmed === '') {
        i++;
        continue;
      }

      // Horizontal Rule
      if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
        blocks.push(<hr key={`hr-${segIdx}-${i}`} className="md-hr" />);
        i++;
        continue;
      }

      // Headings (# .. ######)
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (headingMatch) {
        const level = headingMatch[1]!.length;
        const text = headingMatch[2]!;
        const Tag = (`h${Math.min(6, Math.max(2, level + 1))}` as unknown) as 'h2' | 'h3' | 'h4';
        blocks.push(
          <Tag key={`h-${segIdx}-${i}`} className={`md-heading md-h${level}`}>
            {renderInline(text)}
          </Tag>,
        );
        i++;
        continue;
      }

      // Blockquote (> ...)
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
          quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
          i++;
        }
        blocks.push(
          <blockquote key={`bq-${segIdx}-${i}`} className="md-blockquote">
            {renderInline(quoteLines.join('\n'))}
          </blockquote>,
        );
        continue;
      }

      // Markdown Table (| ... |)
      if (
        trimmed.startsWith('|') &&
        trimmed.endsWith('|') &&
        i + 1 < lines.length &&
        /^\|?[\s:-]+\|[\s|:-]+\|?$/.test((lines[i + 1] ?? '').trim())
      ) {
        const parseRow = (r: string) =>
          r
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim());
        const headers = parseRow(trimmed);
        i += 2; // bỏ qua dòng header và dòng phân cách |---|---|
        const rows: string[][] = [];
        while (
          i < lines.length &&
          (lines[i] ?? '').trim().startsWith('|') &&
          (lines[i] ?? '').trim().endsWith('|')
        ) {
          rows.push(parseRow(lines[i]!));
          i++;
        }
        blocks.push(
          <div key={`tbl-${segIdx}-${i}`} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi}>{renderInline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => (
                      <td key={ci}>{renderInline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Unordered List (- , * , + ) & Task List (- [x] , - [ ])
      if (/^[-*+]\s+/.test(trimmed)) {
        const items: { checked?: boolean; text: string }[] = [];
        while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? '').trim())) {
          const itemLine = (lines[i] ?? '').trim().replace(/^[-*+]\s+/, '');
          const taskMatch = /^\[([ xX])\]\s+(.+)$/.exec(itemLine);
          if (taskMatch) {
            items.push({
              checked: taskMatch[1]!.toLowerCase() === 'x',
              text: taskMatch[2]!,
            });
          } else {
            items.push({ text: itemLine });
          }
          i++;
        }
        blocks.push(
          <ul key={`ul-${segIdx}-${i}`} className="md-list">
            {items.map((it, idx) => (
              <li
                key={idx}
                className={it.checked !== undefined ? 'md-task-item' : undefined}
              >
                {it.checked !== undefined && (
                  <input
                    type="checkbox"
                    checked={it.checked}
                    readOnly
                    style={{ marginRight: '6px', pointerEvents: 'none' }}
                  />
                )}
                <span>{renderInline(it.text)}</span>
              </li>
            ))}
          </ul>,
        );
        continue;
      }

      // Ordered List (1. , 2. )
      if (/^\d+\.\s+/.test(trimmed)) {
        const items: string[] = [];
        while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? '').trim())) {
          items.push((lines[i] ?? '').trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        blocks.push(
          <ol key={`ol-${segIdx}-${i}`} className="md-list md-ol">
            {items.map((it, idx) => (
              <li key={idx}>{renderInline(it)}</li>
            ))}
          </ol>,
        );
        continue;
      }

      // Paragraph
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim() !== '' &&
        !/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*|---|\*\*\*|___|\|.+\|$)/.test(
          (lines[i] ?? '').trim(),
        )
      ) {
        paraLines.push(lines[i]!);
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push(
          <p key={`p-${segIdx}-${i}`} className="md-p">
            {paraLines.map((pl, pi) => (
              <React.Fragment key={pi}>
                {pi > 0 && <br />}
                {renderInline(pl)}
              </React.Fragment>
            ))}
          </p>,
        );
      } else {
        i++;
      }
    }
  });

  return (
    <div className={`markdown-body ${compact ? 'is-compact' : ''} ${className}`.trim()}>
      {blocks}
    </div>
  );
}
