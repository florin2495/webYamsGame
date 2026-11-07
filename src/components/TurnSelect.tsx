"use client";

import { TURN_OPTIONS } from "@/lib/game";

/** Seconds per turn, 20-60 s. */
export function TurnSelect({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      Timp pe tură
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {TURN_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s} secunde
          </option>
        ))}
      </select>
      <span className="text-xs font-normal text-zinc-500">
        Pentru toate cele 3 aruncări și alegerea căsuței. La expirare se joacă automat cea mai bună căsuță.
      </span>
    </label>
  );
}
