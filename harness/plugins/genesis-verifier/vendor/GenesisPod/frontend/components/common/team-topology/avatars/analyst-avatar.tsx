import type { TeamAvatarProps } from './types';

/**
 * Analyst Avatar — Kawaii character holding a clipboard with a chart.
 */
export function AnalystAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Glasses */}
      <circle
        cx="12.5"
        cy="12"
        r="2.5"
        fill="none"
        stroke="#333"
        strokeWidth="0.8"
      />
      <circle
        cx="17.5"
        cy="12"
        r="2.5"
        fill="none"
        stroke="#333"
        strokeWidth="0.8"
      />
      <line x1="15" y1="12" x2="15" y2="12" stroke="#333" strokeWidth="0.8" />
      {/* Eyes (behind glasses) */}
      <circle cx="12.5" cy="12" r="0.8" fill="#333" />
      <circle cx="17.5" cy="12" r="0.8" fill="#333" />
      {/* Mouth */}
      <path
        d="M13.5 16 Q15 17.5 16.5 16"
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

      {/* Clipboard (left hand) */}
      <rect
        x="1"
        y="20"
        width="8"
        height="11"
        rx="1"
        fill="#FFF"
        stroke="#333"
        strokeWidth="0.8"
      />
      <rect
        x="2"
        y="19"
        width="6"
        height="2"
        rx="0.5"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.6"
      />
      {/* Mini bar chart on clipboard */}
      <rect x="3" y="27" width="1.5" height="3" fill="currentColor" />
      <rect x="5" y="25" width="1.5" height="5" fill="currentColor" />
      <rect x="7" y="26" width="1.5" height="4" fill="currentColor" />

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
