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
    // If browser localStorage quota is reached with base64 photos, preserve full records in memory/cloud
    // while keeping a quota-safe lightweight payload in localStorage
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
      try {
        const lightweight = val.map((item: any, idx: number) => {
          // Retain photos for the most recent 25 items in localStorage cache
          if (idx < val.length - 25 && item && item.photo) {
            const { photo, ...rest } = item;
            return rest;
          }
          return item;
        });
        localStorage.setItem(key, JSON.stringify(lightweight));
      } catch (err2) {
        console.warn('Secondary storage fallback notice:', err2);
      }
    }
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
