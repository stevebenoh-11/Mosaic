import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { useStore } from './store';
import './index.css';

registerSW({ immediate: true });

// Exposed for e2e tests and debugging (read-only usage expected).
declare global {
  interface Window {
    __mosaicStore: typeof useStore;
  }
}
window.__mosaicStore = useStore;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
