import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipProps {
  content: string | null | undefined;
  placement?: TooltipPlacement;
  children: React.ReactElement;
}

/**
 * Component bọc phần tử cần hiển thị Custom UI Tooltip chuẩn Warm Cozy Tech.
 * Tự động gắn `data-tooltip` và `data-tooltip-placement` vào phần tử con mà không làm hỏng layout flex/grid.
 */
export function Tooltip({ content, placement, children }: TooltipProps) {
  if (!content) return children;
  const childProps = children.props as Record<string, unknown>;
  const existingTitle = typeof childProps.title === 'string' ? undefined : childProps.title;
  return React.cloneElement(children, {
    ...childProps,
    title: existingTitle,
    'data-tooltip': content,
    ...(placement ? { 'data-tooltip-placement': placement } : {}),
  } as Record<string, unknown>);
}

interface ActiveTooltipState {
  target: HTMLElement;
  text: string;
  preferredPlacement: TooltipPlacement;
  targetRect: DOMRect;
}

interface ComputedPosition {
  top: number;
  left: number;
  actualPlacement: 'top' | 'bottom';
  arrowLeft: number;
}

function extractTooltipFromElement(curr: HTMLElement): { el: HTMLElement; text: string; placement: TooltipPlacement } | null {
  // Tự động chuyển đổi thuộc tính `title` mặc định sang `data-tooltip` để chặn hoàn toàn native browser tooltip
  const rawTitle = curr.getAttribute('title');
  if (rawTitle !== null) {
    const trimmed = rawTitle.trim();
    curr.removeAttribute('title');
    if (trimmed.length > 0 && !curr.hasAttribute('data-tooltip')) {
      curr.setAttribute('data-tooltip', trimmed);
    }
  }

  const tooltipText = curr.getAttribute('data-tooltip')?.trim();
  if (tooltipText) {
    const rawPlacement = curr.getAttribute('data-tooltip-placement') as TooltipPlacement | null;
    const placement: TooltipPlacement =
      rawPlacement === 'bottom' || rawPlacement === 'left' || rawPlacement === 'right' || rawPlacement === 'top'
        ? rawPlacement
        : 'top';
    return { el: curr, text: tooltipText, placement };
  }
  return null;
}

function findTooltipTarget(
  node: EventTarget | null,
  clientX?: number,
  clientY?: number,
): { el: HTMLElement; text: string; placement: TooltipPlacement } | null {
  if (!(node instanceof Element)) return null;

  // Hỗ trợ hiển thị Tooltip ngay cả trên các nút/input bị `disabled` (trình duyệt thường chặn pointer event trực tiếp trên :disabled)
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const disabledCandidates = node.querySelectorAll<HTMLElement>(
      ':disabled[data-tooltip], :disabled[title], [aria-disabled="true"][data-tooltip], [aria-disabled="true"][title]',
    );
    for (const cand of disabledCandidates) {
      const r = cand.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        const res = extractTooltipFromElement(cand);
        if (res) return res;
      }
    }
  }

  let curr: Element | null = node;
  while (curr && curr !== document.body && curr !== document.documentElement) {
    // Bỏ qua thẻ <title> bên trong <svg>
    if (curr.tagName.toLowerCase() === 'svg') {
      curr = curr.parentElement;
      continue;
    }

    if (curr instanceof HTMLElement) {
      const res = extractTooltipFromElement(curr);
      if (res) return res;
    }

    curr = curr.parentElement;
  }

  return null;
}

/**
 * Global Custom UI Tooltip Layer rendered via Portal into `document.body`.
 * Thay thế hoàn toàn native `title` attribute của trình duyệt bằng Tooltip giao diện Warm Cozy Tech
 * hiển thị tức thì (~80ms), tự động tránh tràn mép màn hình (viewport collision detection) và có mũi tên trỏ chính xác.
 */
export function GlobalTooltipLayer() {
  const [active, setActive] = useState<ActiveTooltipState | null>(null);
  const [pos, setPos] = useState<ComputedPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const currentTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const upgradeNodeTitles = (root: ParentNode | Element) => {
      if (root instanceof HTMLElement && root.hasAttribute('title')) {
        const raw = root.getAttribute('title')?.trim() ?? '';
        root.removeAttribute('title');
        if (raw) root.setAttribute('data-tooltip', raw);
      }
      if ('querySelectorAll' in root) {
        const titled = root.querySelectorAll<HTMLElement>('[title]');
        for (const el of titled) {
          if (el.tagName.toLowerCase() === 'svg' || el.tagName.toLowerCase() === 'title') continue;
          const raw = el.getAttribute('title')?.trim() ?? '';
          el.removeAttribute('title');
          if (raw) el.setAttribute('data-tooltip', raw);
        }
      }
    };

    upgradeNodeTitles(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'title' && m.target instanceof HTMLElement) {
          upgradeNodeTitles(m.target);
        } else if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node instanceof Element) upgradeNodeTitles(node);
          }
        }
      }
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title'],
    });

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hideTooltip = () => {
      clearTimer();
      currentTargetRef.current = null;
      setActive(null);
      setPos(null);
    };

    const showForTarget = (found: { el: HTMLElement; text: string; placement: TooltipPlacement }, immediate = false) => {
      if (currentTargetRef.current === found.el) {
        // Cập nhật nội dung nếu data-tooltip thay đổi động
        setActive((prev) =>
          prev && prev.target === found.el && prev.text !== found.text
            ? { ...prev, text: found.text, targetRect: found.el.getBoundingClientRect() }
            : prev,
        );
        return;
      }

      clearTimer();
      currentTargetRef.current = found.el;

      const trigger = () => {
        if (!found.el.isConnected) {
          hideTooltip();
          return;
        }
        const rect = found.el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          hideTooltip();
          return;
        }
        setActive({
          target: found.el,
          text: found.text,
          preferredPlacement: found.placement,
          targetRect: rect,
        });
      };

      if (immediate) {
        trigger();
      } else {
        timerRef.current = window.setTimeout(trigger, 75);
      }
    };

    const onPointerOver = (e: PointerEvent) => {
      const found = findTooltipTarget(e.target, e.clientX, e.clientY);
      if (!found) {
        if (currentTargetRef.current) hideTooltip();
        return;
      }
      // Nếu đang có sẵn một tooltip mở, chuyển sang nút kế bên sẽ hiển thị tức thì (0ms delay)
      showForTarget(found, currentTargetRef.current !== null);
    };

    const onPointerMove = (e: PointerEvent) => {
      // Kiểm tra khi di chuột qua các nút disabled (vì disabled button không tự phát sự kiện pointerover)
      if (e.target instanceof Element) {
        const hasDisabledChild = e.target.querySelector(
          ':disabled[data-tooltip], :disabled[title], [aria-disabled="true"][data-tooltip], [aria-disabled="true"][title]',
        );
        if (hasDisabledChild) {
          const found = findTooltipTarget(e.target, e.clientX, e.clientY);
          if (found) {
            showForTarget(found, currentTargetRef.current !== null);
            return;
          } else if (currentTargetRef.current && currentTargetRef.current.matches(':disabled, [aria-disabled="true"]')) {
            hideTooltip();
          }
        }
      }
    };

    const onPointerOut = (e: PointerEvent) => {
      if (!currentTargetRef.current) return;
      const related = e.relatedTarget as Node | null;
      if (related && currentTargetRef.current.contains(related)) return;
      const nextFound = findTooltipTarget(related, e.clientX, e.clientY);
      if (nextFound) {
        showForTarget(nextFound, true);
        return;
      }
      hideTooltip();
    };

    const onFocusIn = (e: FocusEvent) => {
      const found = findTooltipTarget(e.target);
      if (found) showForTarget(found, true);
    };

    const onFocusOut = () => {
      hideTooltip();
    };

    const onPointerDown = () => {
      hideTooltip();
    };

    const onScrollOrResize = () => {
      if (!currentTargetRef.current) return;
      if (!currentTargetRef.current.isConnected) {
        hideTooltip();
        return;
      }
      const rect = currentTargetRef.current.getBoundingClientRect();
      setActive((prev) => (prev ? { ...prev, targetRect: rect } : null));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideTooltip();
    };

    document.addEventListener('pointerover', onPointerOver, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerout', onPointerOut, true);
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      clearTimer();
      observer.disconnect();
      document.removeEventListener('pointerover', onPointerOver, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerout', onPointerOut, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('focusout', onFocusOut, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!active || !tooltipRef.current) {
      setPos(null);
      return;
    }

    const tipEl = tooltipRef.current;
    const tipRect = tipEl.getBoundingClientRect();
    const { targetRect, preferredPlacement } = active;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 8;
    const margin = 10;

    const targetCenterX = targetRect.left + targetRect.width / 2;

    // Quyết định hiển thị phía trên (top) hay phía dưới (bottom) dựa trên không gian thực tế
    const canFitTop = targetRect.top - tipRect.height - gap >= margin;
    const canFitBottom = targetRect.bottom + tipRect.height + gap <= vh - margin;

    let actualPlacement: 'top' | 'bottom' = 'top';
    if (preferredPlacement === 'bottom') {
      actualPlacement = canFitBottom || !canFitTop ? 'bottom' : 'top';
    } else {
      // Nếu phần tử nằm gần mép trên màn hình (như thanh Top Navbar), tự động lật xuống dưới
      actualPlacement = canFitTop ? 'top' : 'bottom';
    }

    const top =
      actualPlacement === 'top'
        ? Math.max(margin, targetRect.top - tipRect.height - gap)
        : Math.min(vh - tipRect.height - margin, targetRect.bottom + gap);

    let left = targetCenterX - tipRect.width / 2;
    left = Math.max(margin, Math.min(vw - tipRect.width - margin, left));

    const arrowLeft = Math.max(12, Math.min(tipRect.width - 12, targetCenterX - left));

    setPos({ top, left, actualPlacement, arrowLeft });
  }, [active]);

  if (!active || typeof document === 'undefined') return null;

  // Tách phần phím tắt ở cuối chuỗi ví dụ: "Đóng cửa sổ (Esc)" -> label: "Đóng cửa sổ", kbd: "Esc"
  const kbdMatch = active.text.match(/^(.*?)\s*\(([A-Za-z0-9+/\s]{1,12})\)$/);
  const mainLabel = kbdMatch ? kbdMatch[1] : active.text;
  const kbdHint = kbdMatch ? kbdMatch[2] : null;

  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className={`vor-tooltip ${pos ? `vor-tooltip--${pos.actualPlacement} vor-tooltip--ready` : 'vor-tooltip--measuring'}`}
      style={{
        top: pos ? `${pos.top}px` : '-9999px',
        left: pos ? `${pos.left}px` : '-9999px',
        ['--vor-tooltip-arrow-x' as string]: pos ? `${pos.arrowLeft}px` : '50%',
      }}
    >
      <span className="vor-tooltip__text">{mainLabel}</span>
      {kbdHint && <kbd className="vor-tooltip__kbd">{kbdHint}</kbd>}
      <span className="vor-tooltip__arrow" aria-hidden="true" />
    </div>,
    document.body,
  );
}
