import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Keep the offline shell out of the local Vite server. This prevents a
// previously cached module from causing a blank local page after source
// changes. Any old RacePulse dev cache is removed once.
const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(window.location.hostname);

if ('serviceWorker' in navigator && !isLocalDevelopment) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('RacePulsePH offline service worker could not start:', error);
    });
  });
} else if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) =>
    Promise.all(registrations.map((registration) => registration.unregister()))
  );
  void caches.keys().then((keys) =>
    Promise.all(keys
      .filter((key) => key.startsWith('racepulseph-shell-'))
      .map((key) => caches.delete(key)))
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
