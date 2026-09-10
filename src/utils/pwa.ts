export function initPwaInstallPrompt(onPromptReady: (e: any) => void) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    onPromptReady(e);
  });
}

export function isStandaloneApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
}

export function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
}
