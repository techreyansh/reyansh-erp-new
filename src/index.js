import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

function initializeApp() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if (document.readyState === 'complete') {
  initializeApp();
} else {
  window.addEventListener('load', initializeApp);
}

// Register the Factory Ops App service worker (PWA shell/asset cache only).
// Guarded: production builds + browsers that support service workers. Offline
// DATA is handled by the in-app outbox/cache, not the service worker.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL || ''}/service-worker.js`)
      .catch((err) => {
        // Non-fatal: the app still works online without the SW.
        console.warn('[FactoryOps] Service worker registration failed:', err);
      });
  });
}

reportWebVitals();
