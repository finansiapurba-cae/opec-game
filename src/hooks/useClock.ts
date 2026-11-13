import { useEffect, useRef, useState } from 'react';

/** Re-render every `ms` milliseconds; returns Date.now(). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Offset (ms) between the database clock and this device: serverNow ≈ Date.now() + offset. */
export function useServerOffset(serverTime: string | undefined, fetchedAt: number | undefined): number {
  const offset = useRef(0);
  if (serverTime && fetchedAt) {
    offset.current = new Date(serverTime).getTime() - fetchedAt;
  }
  return offset.current;
}

/** Seconds left until an ISO deadline, using the server clock offset; null = no deadline. */
export function useCountdown(deadline: string | null | undefined, offset: number): number | null {
  const now = useNow(500);
  if (!deadline) return null;
  return Math.max(0, (new Date(deadline).getTime() - (now + offset)) / 1000);
}
