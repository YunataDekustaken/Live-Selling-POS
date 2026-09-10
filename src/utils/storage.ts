export function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw || raw === 'undefined' || raw === 'null') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (e) {
    console.warn('Storage JSON parse notice, using fallback:', e);
    return fallback;
  }
}

export function safeGetItem<T = string>(key: string, fallback: T | null = null): string | T | null {
  try {
    const val = localStorage.getItem(key);
    return val !== null && val !== 'undefined' ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

export function safeSetItem(key: string, val: unknown): void {
  try {
    localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
  } catch (e) {
    console.warn('Storage save notice:', e);
  }
}

export function downloadJsonBackup(payload: Record<string, unknown>, filename = 'live_pos_backup.json'): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
