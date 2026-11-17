import React, { useEffect, useRef } from 'react';
import { getTurnstileSiteKey } from '../lib/botProtection';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'compact' | 'flexible';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi | null> | null = null;

function loadTurnstileScript(): Promise<TurnstileApi | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-racepulse-turnstile="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.turnstile || null), { once: true });
      existing.addEventListener('error', () => resolve(null), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.racepulseTurnstile = 'true';
    script.onload = () => resolve(window.turnstile || null);
    script.onerror = () => {
      turnstileScriptPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

interface TurnstileChallengeProps {
  action: string;
  resetNonce?: number;
  onToken: (token: string) => void;
}

/**
 * Renders Cloudflare Turnstile verification when VITE_TURNSTILE_SITE_KEY is configured.
 * Renders nothing when unconfigured so standard builds stay clean.
 */
export default function TurnstileChallenge({ action, resetNonce = 0, onToken }: TurnstileChallengeProps) {
  const siteKey = getTurnstileSiteKey();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!siteKey) return;
    let active = true;

    void loadTurnstileScript().then((api) => {
      if (!active || !api || !containerRef.current) return;
      const isDark = document.documentElement.classList.contains('dark');
      try {
        widgetIdRef.current = api.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: isDark ? 'dark' : 'light',
          size: 'flexible',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        });
      } catch {
        onTokenRef.current('');
      }
    });

    return () => {
      active = false;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Widget may already be detached.
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (!siteKey || resetNonce === 0 || !widgetIdRef.current || !window.turnstile) return;
    try {
      onTokenRef.current('');
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      // Ignore reset errors if widget unloaded.
    }
  }, [siteKey, resetNonce]);

  if (!siteKey) return null;

  return <div ref={containerRef} className="min-h-[66px] w-full" aria-label="Human verification challenge" />;
}
