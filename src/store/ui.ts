'use client';

/**
 * OMNIRA — UI state (Zustand)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean; // mobile drawer
  commandMenuOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setCommandMenuOpen: (open: boolean) => void;
  toggleCommandMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: false,
  commandMenuOpen: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setCommandMenuOpen: (open) => set({ commandMenuOpen: open }),
  toggleCommandMenu: () => set((s) => ({ commandMenuOpen: !s.commandMenuOpen })),
}));
