import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import {
  Capacitor,
  SystemBarType,
  SystemBars,
  SystemBarsStyle,
  type PluginListenerHandle,
} from '@capacitor/core';

type OverlayBackEntry = {
  fn: () => boolean | void;
};

const backOverlayStack: OverlayBackEntry[] = [];

/**
 * Registers an active modal, dialog, or full-screen overlay on the LIFO Android
 * hardware back stack so back presses dismiss the topmost overlay first.
 */
export function useAndroidBackHandler(active: boolean, onBack: () => boolean | void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    const entry: OverlayBackEntry = { fn: () => onBackRef.current() };
    backOverlayStack.push(entry);
    return () => {
      const idx = backOverlayStack.lastIndexOf(entry);
      if (idx !== -1) backOverlayStack.splice(idx, 1);
    };
  }, [active]);
}

/**
 * Keeps Android 15/16+ status and gesture bar icons legible against RacePulsePH's
 * persistent charcoal top bar (.brand-nav) and themed page canvas.
 */
export function syncAndroidSystemBars(
  theme: 'light' | 'dark',
  statusSurface: 'brand-dark' | 'theme' = 'brand-dark',
): void {
  if (!Capacitor.isNativePlatform()) return;

  const statusStyle =
    statusSurface === 'brand-dark'
      ? SystemBarsStyle.Dark
      : theme === 'dark'
        ? SystemBarsStyle.Dark
        : SystemBarsStyle.Light;
  const navStyle = theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light;

  void SystemBars.setStyle({ bar: SystemBarType.StatusBar, style: statusStyle }).catch(() => {});
  void SystemBars.setStyle({ bar: SystemBarType.NavigationBar, style: navStyle }).catch(() => {});
}

export function subscribeAndroidBackButton(onFallbackBack: (canGoBack: boolean) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};

  let active = true;
  let handle: PluginListenerHandle | undefined;

  void App.addListener('backButton', ({ canGoBack }) => {
    for (let i = backOverlayStack.length - 1; i >= 0; i -= 1) {
      const handled = backOverlayStack[i].fn();
      if (handled !== false) return;
    }
    onFallbackBack(canGoBack);
  })
    .then((listener) => {
      if (!active) {
        void listener.remove();
        return;
      }
      handle = listener;
    })
    .catch(() => {});

  return () => {
    active = false;
    if (handle) void handle.remove();
  };
}

export function exitAndroidApp(): void {
  if (!Capacitor.isNativePlatform()) return;
  void App.exitApp().catch(() => {});
}

