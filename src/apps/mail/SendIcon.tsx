// Our own paper airplane, drawn for this repo (no Apple art ships):
// the shape Mail 2–3 used for Send, as three flat folds with a soft gradient.
export function SendIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="mail-send-top" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d6dde6" />
        </linearGradient>
        <linearGradient id="mail-send-under" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fb1c6" />
          <stop offset="1" stopColor="#6c829c" />
        </linearGradient>
      </defs>
      <g stroke="#3d4f66" strokeWidth="0.75" strokeLinejoin="round">
        {/* top wing */}
        <path d="M2 11 L22 2 L9 14 Z" fill="url(#mail-send-top)" />
        {/* far wing, in shadow */}
        <path d="M9 14 L22 2 L14 22 Z" fill="url(#mail-send-under)" />
        {/* keel fold */}
        <path d="M9 14 L11 20 L12.5 16.5 Z" fill="#53698a" />
      </g>
    </svg>
  );
}
