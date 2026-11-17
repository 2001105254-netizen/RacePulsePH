import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface WorkspaceHeaderContextValue {
  leftSlotEl: HTMLDivElement | null;
  rightSlotEl: HTMLDivElement | null;
  setLeftSlotEl: (el: HTMLDivElement | null) => void;
  setRightSlotEl: (el: HTMLDivElement | null) => void;
  desktopLocked: boolean;
  setDesktopLocked: (locked: boolean) => void;
  splitViewportLocked: boolean;
  setSplitViewportLocked: (locked: boolean) => void;
}

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

/**
 * Provides portal containers inside the persistent global navbar and coordinates
 * viewport locking for dense operational consoles and split-pane runner views.
 */
export function WorkspaceHeaderProvider({ children }: { children: React.ReactNode }) {
  const [leftSlotEl, setLeftSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlotEl, setRightSlot] = useState<HTMLDivElement | null>(null);
  const [desktopLocked, setDesktopLockedState] = useState(false);
  const [splitViewportLocked, setSplitViewportLockedState] = useState(false);

  const setLeftSlotEl = useCallback((el: HTMLDivElement | null) => setLeftSlot(el), []);
  const setRightSlotEl = useCallback((el: HTMLDivElement | null) => setRightSlot(el), []);
  const setDesktopLocked = useCallback((locked: boolean) => setDesktopLockedState(locked), []);
  const setSplitViewportLocked = useCallback((locked: boolean) => setSplitViewportLockedState(locked), []);

  const value = useMemo(
    () => ({
      leftSlotEl,
      rightSlotEl,
      setLeftSlotEl,
      setRightSlotEl,
      desktopLocked,
      setDesktopLocked,
      splitViewportLocked,
      setSplitViewportLocked,
    }),
    [
      leftSlotEl,
      rightSlotEl,
      setLeftSlotEl,
      setRightSlotEl,
      desktopLocked,
      setDesktopLocked,
      splitViewportLocked,
      setSplitViewportLocked,
    ],
  );

  return <WorkspaceHeaderContext.Provider value={value}>{children}</WorkspaceHeaderContext.Provider>;
}

export function useWorkspaceHeader() {
  return useContext(WorkspaceHeaderContext);
}
