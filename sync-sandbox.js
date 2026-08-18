'use strict';

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const message = event.data;
  if (!message || message.kind !== 'work1-sync-request') return;
  if (typeof message.url !== 'string' || typeof message.callback !== 'string' || typeof message.token !== 'string') return;
  if (!/^[A-Za-z_$][0-9A-Za-z_$]{0,80}$/.test(message.callback)) return;
  let target;
  try {
    target = new URL(message.url);
  } catch {
    return;
  }
  if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(target.pathname)) return;
  const callback = message.callback;
  window[callback] = (value) => {
    window.parent.postMessage({ kind: 'work1-sync-response', token: message.token, value }, '*');
    delete window[callback];
  };
  const script = document.createElement('script');
  script.referrerPolicy = 'no-referrer';
  script.src = target.toString();
  script.onerror = () => window.parent.postMessage({ kind: 'work1-sync-error', token: message.token }, '*');
  document.head.append(script);
}, { once: true });
