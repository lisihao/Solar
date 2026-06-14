import type { TeamAvatarProps } from './types';

/**
 * DebaterCon Avatar — Kawaii character holding a shield (defensive stance).
 */
export function DebaterConAvatar({ size, status }: TeamAvatarProps) {
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
      {/* Cautious eyebrows */}
      <line
        x1="10.5"
        y1="11"
        x2="13.5"
        y2="10"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      <line
        x1="16.5"
        y1="10"
        x2="19.5"
        y2="11"
        stroke="#333"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
      {/* Eyes */}
      <circle cx="12.5" cy="13" r="1" fill="#333" />
      <circle cx="17.5" cy="13" r="1" fill="#333" />
      {/* Thoughtful mouth */}
      <path
        d="M13.5 16 Q15 17 16.5 16"
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

      {/* Large shield (left hand) */}
      <path
        d="M1 18 L1 30 Q5 35 5 30 L5 18Z"
        fill="currentColor"
        stroke="#333"
        strokeWidth="0.8"
      />
      {/* Shield cross emblem */}
      <line
        x1="3"
        y1="20"
        x2="3"
        y2="28"
        stroke="#FFF"
        strokeWidth="0.8"
        opacity="0.6"
      />
      <line
        x1="1.5"
        y1="24"
        x2="4.5"
        y2="24"
        stroke="#FFF"
        strokeWidth="0.8"
        opacity="0.6"
      />

      {/* Right arm braced */}
      <line
        x1="22"
        y1="24"
        x2="24"
        y2="28"
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
