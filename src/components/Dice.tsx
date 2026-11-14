"use client";

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [28, 28],
    [50, 50],
    [72, 72],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [28, 28],
    [72, 28],
    [50, 50],
    [28, 72],
    [72, 72],
  ],
  6: [
    [28, 26],
    [72, 26],
    [28, 50],
    [72, 50],
    [28, 74],
    [72, 74],
  ],
};

/** One die. value 0 = not rolled yet (blank). */
export function Die({
  value,
  held,
  shaking,
  onClick,
  size = 56,
  label,
}: {
  value: number;
  held?: boolean;
  shaking?: boolean;
  onClick?: () => void;
  size?: number;
  label?: string;
}) {
  const face = (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className={shaking ? "dice-shake" : ""}>
      <rect
        x="4"
        y="4"
        width="92"
        height="92"
        rx="18"
        className={
          held
            ? "fill-amber-100 stroke-amber-500 dark:fill-amber-900/60 dark:stroke-amber-400"
            : value === 0
              ? "fill-zinc-100 stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700"
              : "fill-white stroke-zinc-300 dark:fill-zinc-100 dark:stroke-zinc-500"
        }
        strokeWidth="5"
      />
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="9" className="fill-zinc-900" />
      ))}
      {value === 0 && (
        <text x="50" y="62" textAnchor="middle" fontSize="36" className="fill-zinc-400">
          ?
        </text>
      )}
    </svg>
  );
  if (!onClick) return <span aria-label={label ?? (value ? `zar ${value}` : "zar nearuncat")}>{face}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={held}
      data-testid="die"
      aria-label={label ?? `zar ${value}${held ? ", păstrat" : ""}`}
      className={`rounded-2xl transition-transform active:scale-95 ${held ? "-translate-y-1" : ""}`}
    >
      {face}
    </button>
  );
}

/** Small inline dice row, for the log line. */
export function MiniDice({ dice }: { dice: number[] }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {dice.map((d, i) => (
        <Die key={i} value={d} size={16} />
      ))}
    </span>
  );
}
