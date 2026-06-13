import type { TeamAvatarProps } from './types';

/**
 * Reviewer Avatar — Kawaii character with a shield and checkmark.
 */
export function ReviewerAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Serious eyebrows */}
      <line
        x1="11"
        y1="10"
        x2="14"
        y2="10.5"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <line
        x1="16"
        y1="10.5"
        x2="19"
        y2="10"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="12.5" r="1" fill="#333" />
      <circle cx="17.5" cy="12.5" r="1" fill="#333" />
      {/* Firm mouth */}
      <line
        x1="13"
        y1="16.5"
        x2="17"
        y2="16.5"
        stroke="#333"
        strokeWidth="0.8"
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

      {/* Shield (left hand) */}
      <path
        d="M1 20 L1 28 Q5 32 5 28 L5 20Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      {/* Checkmark on shield */}
      <path
        d="M2 24 L3.5 26 L4.5 22"
        stroke="#FFF"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
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
