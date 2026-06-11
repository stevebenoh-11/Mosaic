import { create } from 'zustand';
import type { SyncLogEntry, SyncStatus } from './types';

interface SyncUiState {
  status: SyncStatus;
  statusDetail: string | null;
  connected: boolean;
  clientIdPresent: boolean;
  account: { email: string; name: string } | null;
  lastSyncedAt: number | null;
  log: SyncLogEntry[];
  set(partial: Partial<Omit<SyncUiState, 'set'>>): void;
}

export const useSyncStore = create<SyncUiState>((set) => ({
  status: 'disabled',
  statusDetail: null,
  connected: false,
  clientIdPresent: false,
  account: null,
  lastSyncedAt: null,
  log: [],
  set: (partial) => set(partial),
}));
