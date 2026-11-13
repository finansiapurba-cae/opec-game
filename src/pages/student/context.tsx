import { createContext, useContext } from 'react';
import type { GameConfig } from '@/lib/engine';
import type { ChatMessage, Notice, Period, StudentState } from '@/lib/types';

export interface StudentContextValue {
  s: StudentState;
  cfg: GameConfig;
  /** serverNow ≈ Date.now() + offset */
  offset: number;
  currentPeriod: Period | null;
  /** the open period, if any (may have just expired on the clock) */
  openPeriod: Period | null;
  /** period that communication rules refer to (open period or the next one) */
  talkPeriod: number;
  lastClosed: number;
  chat: ChatMessage[];
  notices: Notice[];
  refresh: () => void;
  connected: boolean;
}

export const StudentContext = createContext<StudentContextValue | null>(null);

export function useStudent(): StudentContextValue {
  const v = useContext(StudentContext);
  if (!v) throw new Error('useStudent outside provider');
  return v;
}
