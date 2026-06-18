const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

export interface SfCacheEntry<T> {
  data: T;
  savedAt: number;
}

export function sfCacheGet<T>(key: string): SfCacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: SfCacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.savedAt > TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function sfCacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // quota exceeded — silently skip
  }
}

export function sfCacheClear(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

export function sfCacheAge(savedAt: number): string {
  const diff = Date.now() - savedAt;
  const min  = Math.floor(diff / 60_000);
  if (min < 1)  return "agora mesmo";
  if (min < 60) return `${min} min atrás`;
  const h = Math.floor(min / 60);
  return `${h}h atrás`;
}
