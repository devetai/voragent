import { useId } from 'react';

export type LoaderVariant =
  | 'ouroboros'
  | 'grow'
  | 'fade'
  | 'pulse'
  | 'orbit'
  | 'ripple'
  | 'dispatch'
  | 'infinity'
  | 'wave'
  | 'dots'
  | 'crawl';
export type LoaderSize = 'sm' | 'md' | 'lg';

export interface SnakeLoaderProps {
  size?: LoaderSize;
  variant?: LoaderVariant;
  label?: string;
  inline?: boolean;
  className?: string;
}

/**
 * Hiệu ứng loading dùng chung cho toàn bộ hệ thống voragent.
 * Chuyển động dựa trực tiếp trên Logo Ouroboros của voragent (Cố định không xoay logo):
 * - 'ouroboros' / 'grow' (Mặc định): Con rắn xuất hiện dần dần, dài dần ra từ đuôi tới khi hoàn thiện trọn vẹn logo, mắt chớp sáng rồi lặp lại.
 * - 'fade': Rắn dài dần ra đến khi hoàn thiện logo, giữ nguyên một nhịp thở rồi mờ dần reset.
 * - 'pulse': Rắn co dãn nhịp thở tại chỗ (không bao giờ biến mất hoàn toàn).
 * - 'orbit': Logo Ouroboros kèm hạt task/handoff cam ấm bay quỹ đạo xuyên tâm.
 * - 'ripple': Logo Ouroboros kèm sóng lan tỏa mờ nhạt thư thái.
 * - 'infinity': Chú Rắn trườn theo đường cong vô cực (∞).
 * - 'wave' & 'dots': Biến thể tối giản cho button nhỏ.
 * - 'dispatch': Hoạt cảnh Rắn Mẹ giao việc cho Rắn Con.
 */
export function SnakeLoader({
  size = 'md',
  variant = 'ouroboros',
  label,
  inline = false,
  className = '',
}: SnakeLoaderProps) {
  const maskId = useId();

  const renderIndicator = () => {
    switch (variant) {
      case 'fade':
        return (
          <div className={`snake-loader-ouroboros fade-mode size-${size}`} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" className="ouro-grow-svg">
              <mask
                id={`mask-fade-${maskId}`}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="32"
                height="32"
              >
                <rect width="32" height="32" fill="#FFFFFF" />
                <circle cx="23.42" cy="8.58" r="1.15" fill="#000000" className="ouro-fade-eye-mask" />
              </mask>
              <g mask={`url(#mask-fade-${maskId})`}>
                <path
                  d="M 26.14 18.72 A 10.5 10.5 0 1 1 23.42 8.58"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  fill="none"
                  className="ouro-fade-body"
                />
              </g>
              <circle cx="23.42" cy="8.58" r="0.95" className="ouro-fade-eye-dot" />
            </svg>
          </div>
        );

      case 'pulse':
        return (
          <div className={`snake-loader-ouroboros pulse-mode size-${size}`} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" className="ouro-grow-svg">
              <mask
                id={`mask-pulse-${maskId}`}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="32"
                height="32"
              >
                <rect width="32" height="32" fill="#FFFFFF" />
                <circle cx="23.42" cy="8.58" r="1.15" fill="#000000" className="ouro-pulse-eye-mask" />
              </mask>
              <g mask={`url(#mask-pulse-${maskId})`}>
                <path
                  d="M 26.14 18.72 A 10.5 10.5 0 1 1 23.42 8.58"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  fill="none"
                  className="ouro-pulse-body"
                />
              </g>
              <circle cx="23.42" cy="8.58" r="0.95" className="ouro-pulse-eye-dot" />
            </svg>
          </div>
        );

      case 'ouroboros':
      case 'grow':
      default:
        return (
          <div className={`snake-loader-ouroboros grow-mode size-${size}`} aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" className="ouro-grow-svg">
              <mask
                id={`mask-grow-${maskId}`}
                maskUnits="userSpaceOnUse"
                x="0"
                y="0"
                width="32"
                height="32"
              >
                <rect width="32" height="32" fill="#FFFFFF" />
                <circle cx="23.42" cy="8.58" r="1.15" fill="#000000" className="ouro-grow-eye-mask" />
              </mask>
              <g mask={`url(#mask-grow-${maskId})`}>
                <path
                  d="M 26.14 18.72 A 10.5 10.5 0 1 1 23.42 8.58"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  fill="none"
                  className="ouro-grow-body"
                />
              </g>
              <circle cx="23.42" cy="8.58" r="0.95" className="ouro-grow-eye-dot" />
            </svg>
          </div>
        );

      case 'infinity':
        return (
          <div className={`snake-loader-infinity size-${size}`} aria-hidden="true">
            <svg viewBox="0 0 64 36" className="infinity-svg" fill="none">
              <path
                className="infinity-track-path"
                strokeWidth={size === 'sm' ? 4 : 4.5}
                d="M 18 18 C 18 10 6 10 6 18 C 6 26 18 26 32 18 C 46 10 58 10 58 18 C 58 26 46 26 32 18 Z"
              />
              <path
                className="infinity-snake-path"
                strokeWidth={size === 'sm' ? 4.5 : 5.2}
                d="M 18 18 C 18 10 6 10 6 18 C 6 26 18 26 32 18 C 46 10 58 10 58 18 C 58 26 46 26 32 18 Z"
              />
            </svg>
          </div>
        );

      case 'wave':
        return (
          <div className={`snake-loader-wave size-${size}`} aria-hidden="true">
            <span className="wave-seg" />
            <span className="wave-seg" />
            <span className="wave-seg" />
            <span className="wave-seg" />
          </div>
        );

      case 'dots':
        return (
          <div className={`snake-loader-dots size-${size}`} aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        );

      case 'dispatch':
        return (
          <div className={`snake-loader-dispatch size-${size}`} aria-hidden="true">
            {/* Rắn Mẹ (Orchestrator) bên trái - Chibi Tech Lead */}
            <svg className="dispatch-boss" viewBox="0 0 90 80" fill="none">
              <path
                d="M 18 64 C 10 64 6 56 10 48 C 14 40 24 38 34 40 C 44 42 54 44 64 44 C 74 44 80 52 76 60 C 72 68 60 70 46 70 C 32 70 24 70 18 64 Z"
                fill="currentColor"
              />
              <path
                d="M 24 60 C 30 64 48 64 62 60 C 68 58 70 54 67 51 C 62 54 48 56 34 54 C 26 53 22 57 24 60 Z"
                fill="#F3EDE2"
              />
              <path
                d="M 36 48 C 36 36 44 30 50 24"
                stroke="currentColor"
                strokeWidth="14"
                strokeLinecap="round"
              />
              <path
                d="M 38 46 C 40 38 46 32 50 28"
                stroke="#F3EDE2"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M 12 50 C 6 46 4 38 9 34 C 12 31 16 34 15 38"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
              />
              <ellipse cx="52" cy="20" rx="17" ry="14" fill="currentColor" />
              <circle cx="45" cy="18" r="5" stroke="#FAF8F5" strokeWidth="1.8" fill="#2B2622" />
              <circle cx="59" cy="18" r="5" stroke="#FAF8F5" strokeWidth="1.8" fill="#2B2622" />
              <line x1="50" y1="18" x2="54" y2="18" stroke="#FAF8F5" strokeWidth="1.8" />
              <circle cx="45" cy="18" r="2.8" fill="#FFFFFF" />
              <circle cx="45.5" cy="17.5" r="1.9" fill="currentColor" />
              <circle cx="44.5" cy="16.5" r="0.8" fill="#FFFFFF" />
              <circle cx="59" cy="18" r="2.8" fill="#FFFFFF" />
              <circle cx="58.5" cy="17.5" r="1.9" fill="currentColor" />
              <circle cx="57.5" cy="16.5" r="0.8" fill="#FFFFFF" />
              <path
                d="M 35 17 C 35 7 69 7 69 17"
                stroke="#E8E2D8"
                strokeWidth="2"
                strokeLinecap="round"
                fill="none"
              />
              <rect x="32" y="15" width="4" height="8" rx="2" fill="#D97757" />
              <rect x="68" y="15" width="4" height="8" rx="2" fill="#D97757" />
              <path
                d="M 35 21 C 37 27 45 27 48 26"
                stroke="#E8E2D8"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="49" cy="26" r="1.4" fill="#D97757" />
              <ellipse cx="37" cy="24" rx="2.8" ry="1.4" fill="#FCA5A5" opacity="0.85" />
              <ellipse cx="67" cy="24" rx="2.8" ry="1.4" fill="#FCA5A5" opacity="0.85" />
              <path
                d="M 50 25 Q 52 27 54 25"
                stroke="#FFFFFF"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>

            {/* Gói Task bay từ Rắn Mẹ sang Rắn Con */}
            <div className="dispatch-parcel">
              <span className="dispatch-tag">TASK</span>
              <span>&lt;/&gt;</span>
            </div>

            {/* Đàn Rắn Con trườn tới đón việc (Đầu hướng sang trái về Rắn Mẹ) */}
            <div className="dispatch-babies">
              {/* Rắn con 1: Claude badge (Đầu hướng sang trái, ngậm task mang về) */}
              <div className="dispatch-baby dispatch-baby-1">
                <svg className="baby-svg" viewBox="0 0 65 52" fill="none">
                  <g className="baby-tail-wag">
                    <path
                      d="M 53 36 C 59 36 61 28 57 22 C 54 18 49 21 51 26"
                      stroke="currentColor"
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </g>
                  <path
                    d="M 51 36 C 43 36 39 26 31 26 C 25 26 21 30 15 29"
                    stroke="currentColor"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 47 36 C 41 36 37 28 31 28 C 26 28 22 31 17 30"
                    stroke="#F3EDE2"
                    strokeWidth="3.8"
                    strokeLinecap="round"
                  />
                  <ellipse cx="17" cy="18" rx="13" ry="11" fill="currentColor" />
                  <ellipse cx="8" cy="21" rx="2.2" ry="1.3" fill="#FCA5A5" />
                  <ellipse cx="26" cy="21" rx="2.2" ry="1.3" fill="#FCA5A5" />
                  <circle cx="17" cy="7" r="3" fill="#D97757" />
                  <ellipse cx="12" cy="15" rx="3.5" ry="4.2" fill="#FFFFFF" />
                  <ellipse cx="11" cy="15" rx="2.5" ry="3.2" fill="currentColor" />
                  <circle cx="10" cy="13.5" r="1" fill="#FFFFFF" />
                  <ellipse cx="22" cy="15" rx="3.5" ry="4.2" fill="#FFFFFF" />
                  <ellipse cx="21" cy="15" rx="2.5" ry="3.2" fill="currentColor" />
                  <circle cx="20" cy="13.5" r="1" fill="#FFFFFF" />
                  <path d="M 15 20 C 15 24 19 24 19 20 Z" fill="#FCA5A5" />
                </svg>

                {/* Thẻ Task ngậm trước mồm và di chuyển cùng Rắn Con */}
                <div className="baby-carried-task">
                  <span className="dispatch-tag">TASK</span>
                  <span>&lt;/&gt;</span>
                </div>
              </div>

              {/* Rắn con 2: Codex badge (Đầu hướng sang trái, ngậm task mang về) */}
              <div className="dispatch-baby dispatch-baby-2">
                <svg className="baby-svg" viewBox="0 0 65 52" fill="none">
                  <g className="baby-tail-wag">
                    <path
                      d="M 53 36 C 59 36 61 28 57 22 C 54 18 49 21 51 26"
                      stroke="currentColor"
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </g>
                  <path
                    d="M 51 36 C 43 36 39 26 31 26 C 25 26 21 30 15 29"
                    stroke="currentColor"
                    strokeWidth="11"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 47 36 C 41 36 37 28 31 28 C 26 28 22 31 17 30"
                    stroke="#F3EDE2"
                    strokeWidth="3.8"
                    strokeLinecap="round"
                  />
                  <ellipse cx="17" cy="18" rx="13" ry="11" fill="currentColor" />
                  <ellipse cx="8" cy="21" rx="2.2" ry="1.3" fill="#FCA5A5" />
                  <ellipse cx="26" cy="21" rx="2.2" ry="1.3" fill="#FCA5A5" />
                  <circle cx="17" cy="7" r="3" fill="#10A37F" />
                  <ellipse cx="12" cy="15" rx="3.5" ry="4.2" fill="#FFFFFF" />
                  <ellipse cx="11" cy="15" rx="2.5" ry="3.2" fill="currentColor" />
                  <circle cx="10" cy="13.5" r="1" fill="#FFFFFF" />
                  <ellipse cx="22" cy="15" rx="3.5" ry="4.2" fill="#FFFFFF" />
                  <ellipse cx="21" cy="15" rx="2.5" ry="3.2" fill="currentColor" />
                  <circle cx="20" cy="13.5" r="1" fill="#FFFFFF" />
                  <path d="M 15 20 C 15 24 19 24 19 20 Z" fill="#FCA5A5" />
                </svg>

                {/* Thẻ Task ngậm trước mồm và di chuyển cùng Rắn Con */}
                <div className="baby-carried-task">
                  <span className="dispatch-tag">TASK</span>
                  <span>&lt;/&gt;</span>
                </div>
              </div>
            </div>
          </div>
        );
    }
  };

  const containerClasses = [
    'snake-loader-container',
    `size-${size}`,
    variant,
    inline ? 'is-inline' : 'is-block',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses} role="status" aria-live="polite">
      {renderIndicator()}
      {label && <span className="snake-loader-label">{label}</span>}
      <span className="sr-only">Đang xử lý…</span>
    </div>
  );
}
