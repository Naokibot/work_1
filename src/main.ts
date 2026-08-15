import { App } from './app/app.js';

async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const url = new URL('sw.js', document.baseURI);
    await navigator.serviceWorker.register(url, { scope: './' });
  } catch {
    // The app remains usable online if service-worker registration is unavailable.
  }
}

const app = new App();
await app.init();
void registerServiceWorker();
