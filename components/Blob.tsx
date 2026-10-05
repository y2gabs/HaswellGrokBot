/**
 * The bots' mascot: a soft blob with two eyes, in the spirit of Grok Bot's
 * characters. Each bot has its own color; `variant` changes the silhouette.
 */
type Props = {
  color: string;
  accent?: string;
  size?: number;
  variant?: number;
  className?: string;
  /** Eyes look toward the viewer's right while the bot is working. */
  busy?: boolean;
};

const SHAPES = [
  "M50 6c22 0 40 16 40 40 0 26-14 48-40 48S10 72 10 46C10 22 28 6 50 6Z",
  "M52 8c20 2 38 18 36 42-2 26-18 44-40 42C26 90 10 72 12 48 14 24 30 6 52 8Z",
  "M50 10c24-2 42 18 38 42-4 22-20 40-40 38C26 88 8 70 12 46 16 24 28 12 50 10Z",
];

export function Blob({ color, accent, size = 56, variant = 0, className, busy }: Props) {
  const shape = SHAPES[variant % SHAPES.length];
  const dx = busy ? 3 : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      style={{ filter: "drop-shadow(0 6px 14px rgba(0,0,0,.35))" }}
    >
      <defs>
        <radialGradient id={`g-${color.slice(1)}-${variant}`} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={accent ?? color} />
          <stop offset="100%" stopColor={color} />
        </radialGradient>
      </defs>
      <path d={shape} fill={`url(#g-${color.slice(1)}-${variant})`} />
      <g className={busy ? "blob-eyes-busy" : "blob-eyes"}>
        <ellipse cx={40 + dx} cy={44} rx={6} ry={9} fill="#0b0b0c" />
        <ellipse cx={62 + dx} cy={44} rx={6} ry={9} fill="#0b0b0c" />
        <circle cx={42 + dx} cy={40} r={2} fill="#fff" />
        <circle cx={64 + dx} cy={40} r={2} fill="#fff" />
      </g>
    </svg>
  );
}
