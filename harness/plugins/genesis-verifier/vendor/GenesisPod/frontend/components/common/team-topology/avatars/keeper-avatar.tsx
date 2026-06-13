import type { TeamAvatarProps } from './types';

/**
 * Keeper Avatar — Kawaii character holding a book/scroll.
 */
export function KeeperAvatar({ size, status }: TeamAvatarProps) {
  const h = size;
  const w = h * 0.6;
  const isWorking = status === 'working';

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 30 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={isWorking ? 'animate-bounce-subtle' : undefined}
    >
      {/* Head */}
      <circle
        cx="15"
        cy="13"
        r="7"
        fill="#FFD7B5"
        stroke="#333"
        strokeWidth="1"
      />
      {/* Wise eyebrows */}
      <line
        x1="11"
        y1="9.5"
        x2="13.5"
        y2="10"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="10"
        x2="19"
        y2="9.5"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="12.5" r="1" fill="#333" />
      <circle cx="17.5" cy="12.5" r="1" fill="#333" />
      {/* Gentle smile */}
      <path
        d="M13 16 Q15 17.5 17 16"
        stroke="#333"
        strokeWidth="0.8"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body */}
      <path
        d="M10 20 L8 34 L22 34 L20 20Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Book (held in front with both hands) */}
      <rect
        x="5"
        y="24"
        width="8"
        height="6"
        rx="0.5"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      <line x1="9" y1="24" x2="9" y2="30" stroke="#333" strokeWidth="0.5" />
      {/* Book pages */}
      <line x1="6.5" y1="26" x2="8.5" y2="26" stroke="#FFF" strokeWidth="0.4" />
      <line
        x1="6.5"
        y1="27.5"
        x2="8.5"
        y2="27.5"
        stroke="#FFF"
        strokeWidth="0.4"
      />
      <line
        x1="9.5"
        y1="26"
        x2="11.5"
        y2="26"
        stroke="#FFF"
        strokeWidth="0.4"
      />
      <line
        x1="9.5"
        y1="27.5"
        x2="11.5"
        y2="27.5"
        stroke="#FFF"
        strokeWidth="0.4"
      />

      {/* Right arm */}
      <line
        x1="22"
        y1="24"
        x2="25"
        y2="30"
        stroke="#333"
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Legs */}
      <line
        x1="12"
        y1="34"
        x2="11"
        y2="41"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="18"
        y1="34"
        x2="19"
        y2="41"
        stroke="#333"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Shoes */}
      <ellipse cx="10" cy="41.5" rx="2.5" ry="1.5" fill="#333" />
      <ellipse cx="20" cy="41.5" rx="2.5" ry="1.5" fill="#333" />
    </svg>
  );
}
