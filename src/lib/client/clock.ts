"use client";

import { useSyncExternalStore } from "react";

// A shared ticking clock (ms epoch, device time), for countdowns. One interval for the whole page.
let now = 0;
let timer: number | undefined;
const subs = new Set<() => void>();

function subscribe(cb: () => void) {
  subs.add(cb);
  if (timer === undefined) {
    now = Date.now();
    timer = window.setInterval(() => {
      now = Date.now();
      subs.forEach((f) => f());
    }, 500);
  }
  return () => {
    subs.delete(cb);
    if (subs.size === 0 && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

/** Device time, refreshed twice a second. 0 during SSR and before the first tick. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}
