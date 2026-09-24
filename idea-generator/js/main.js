// Punto de entrada: elige almacenamiento e IA según dónde se abra la app.
//  - Instalada en el móvil (PWA): IndexedDB, generador sin conexión y, si hay clave, la API de Anthropic.
//  - Dentro de claude.ai: base de datos privada de la cuenta y Claude sin necesidad de clave.

import { createApp } from './app.js';
import { openStore } from './store.js';

// claude.ai expone `window.claude.use` a las páginas que aloja; en la app instalada no existe.
const claude = typeof window.claude?.use === 'function' ? window.claude : null;

function registerServiceWorker() {
  if (claude || !('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Sin modo sin conexión:', error));
}

async function boot() {
  const app = createApp({ claude });
  app.start();
  app.detectAi();
  await app.attachStore(await openStore({ claude }));
  registerServiceWorker();
}

boot();
