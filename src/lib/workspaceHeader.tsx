import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface WorkspaceHeaderContextValue {
  leftSlotEl: HTMLDivElement | null;
  rightSlotEl: HTMLDivElement | null;
  setLeftSlotEl: (el: HTMLDivElement | null) => void;
  setRightSlotEl: (el: HTMLDivElement | null) => void;
  desktopLocked: boolean;
  setDesktopLocked: (locked: boolean) => void;
}

const WorkspaceHeaderContext = createContext<WorkspaceHeaderContextValue | null>(null);

/**
 * Provides portal containers inside the persistent global navbar and coordinates
 * desktop viewport-locking for dense operational consoles such as Engraving.
 */
export function WorkspaceHeaderProvider({ children }: { children: React.ReactNode }) {
  const [leftSlotEl, setLeftSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlotEl, setRightSlot] = useState<HTMLDivElement | null>(null);
  const [desktopLocked, setDesktopLockedState] = useState(false);

  const setLeftSlotEl = useCallback((el: HTMLDivElement | null) => setLeftSlot(el), []);
  const setRightSlotEl = useCallback((el: HTMLDivElement | null) => setRightSlot(el), []);
  const setDesktopLocked = useCallback((locked: boolean) => setDesktopLockedState(locked), []);

  const value = useMemo(
    () => ({ leftSlotEl, rightSlotEl, setLeftSlotEl, setRightSlotEl, desktopLocked, setDesktopLocked }),
    [leftSlotEl, rightSlotEl, setLeftSlotEl, setRightSlotEl, desktopLocked, setDesktopLocked],
  );

  return <WorkspaceHeaderContext.Provider value={value}>{children}</WorkspaceHeaderContext.Provider>;
}

export function useWorkspaceHeader() {
  return useContext(WorkspaceHeaderContext);
}
