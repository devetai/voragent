import { useId } from 'react';

export type LogoVariant = 'ouroboros' | 'coiled' | 'v-monogram';

export interface LogoProps {
  size?: number;
  showWordmark?: boolean;
  variant?: LogoVariant;
  color?: string;
  className?: string;
}

/**
 * Logo chính thức của voragent.
 * Thiết kế phẳng, đơn sắc, cấu trúc hình học đồng tâm tuyệt đối.
 */
export function Logo({
  size = 24,
  showWordmark = false,
  variant = 'ouroboros',
  color = 'currentColor',
  className = '',
}: LogoProps) {
  const maskId = useId();

  const renderIcon = () => {
    switch (variant) {
      case 'coiled':
        return (
          <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="logo-icon"
            aria-hidden="true"
          >
            <mask
              id={`mask-coiled-${maskId}`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="32"
              height="32"
            >
              <rect width="32" height="32" fill="#FFFFFF" />
              <circle cx="22.5" cy="8.5" r="1.15" fill="#000000" />
            </mask>
            <g mask={`url(#mask-coiled-${maskId})`}>
              <path
                d="M 22.5 8.5 A 10.5 10.5 0 1 0 25.5 19 C 25 21.5 22 23 19 22"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          </svg>
        );

      case 'v-monogram':
        return (
          <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="logo-icon"
            aria-hidden="true"
          >
            <mask
              id={`mask-v-${maskId}`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="32"
              height="32"
            >
              <rect width="32" height="32" fill="#FFFFFF" />
              <circle cx="24.5" cy="9.5" r="1.15" fill="#000000" />
            </mask>
            <g mask={`url(#mask-v-${maskId})`}>
              <path
                d="M 7.5 9.5 L 14.5 22.5 C 15.3 24 16.7 24 17.5 22.5 L 24.5 9.5"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          </svg>
        );

      case 'ouroboros':
      default:
        return (
          <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="logo-icon"
            aria-hidden="true"
          >
            <mask
              id={`mask-ouroboros-${maskId}`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="32"
              height="32"
            >
              <rect width="32" height="32" fill="#FFFFFF" />
              {/* Mắt rắn âm bản đục lỗ trong suốt tại chính tâm đầu rắn */}
              <circle cx="23.42" cy="8.58" r="1.15" fill="#000000" />
            </mask>
            <g mask={`url(#mask-ouroboros-${maskId})`}>
              {/* Thân rắn Ouroboros chuẩn xác hình học: R=10.5, stroke=5, bo tròn sinh học mượt mà */}
              <path
                d="M 23.42 8.58 A 10.5 10.5 0 1 0 26.14 18.72"
                stroke={color}
                strokeWidth="5"
                strokeLinecap="round"
                fill="none"
              />
            </g>
          </svg>
        );
    }
  };

  if (!showWordmark) {
    return <span className={`logo-wrap ${className}`}>{renderIcon()}</span>;
  }

  return (
    <span
      className={`logo-wrap with-wordmark ${className}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
    >
      {renderIcon()}
      <span className="logo-wordmark" style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
        voragent
      </span>
    </span>
  );
}
