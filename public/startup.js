// Match the saved app appearance before its first render. CSS handles the system default.
try {
  const savedTheme = localStorage.getItem('racepulse_theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.dataset.startupTheme = savedTheme;
  }
} catch {
  // Storage may be unavailable in an embedded or private browser.
}

// A failed entry module cannot mount the app's own error UI.
window.addEventListener('error', (event) => {
  if (!(event.target instanceof HTMLScriptElement) || event.target.type !== 'module') return;
  const showRecovery = () => {
    const screen = document.querySelector('.startup-screen');
    const recovery = screen?.querySelector('.startup-recovery');
    if (!recovery?.hidden) return;
    screen.querySelector('.startup-pulse').remove();
    screen.querySelector('progress').remove();
    recovery.hidden = false;
    recovery.querySelector('button').addEventListener('click', () => window.location.reload());
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showRecovery, { once: true });
  } else {
    showRecovery();
  }
}, true);
