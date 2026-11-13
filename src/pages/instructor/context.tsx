import { createContext, useContext } from 'react';
import type { GameConfig } from '@/lib/engine';
import type { ChatMessage, Group, InstructorState, Period, World } from '@/lib/types';

export interface InstructorContextValue {
  st: InstructorState;
  cfg: GameConfig;
  offset: number;
  chat: ChatMessage[];
  currentPeriod: Period | null;
  openPeriod: Period | null;
  talkPeriod: number;
  worldById: Map<string, World>;
  groupById: Map<string, Group>;
  /** call an instructor RPC with toasts + refresh */
  act: <T = unknown>(fn: string, args?: Record<string, unknown>, success?: string) => Promise<T | undefined>;
  busy: string | null;
  refresh: () => void;
}

export const InstructorContext = createContext<InstructorContextValue | null>(null);

export function useInstructor() {
  const v = useContext(InstructorContext);
  if (!v) throw new Error('useInstructor outside provider');
  return v;
}
