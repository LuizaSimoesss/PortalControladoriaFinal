const STORAGE_KEY = "salesforce_saved_queries_v1";
const MAX_ENTRIES = 50;

export interface SavedQuery {
  id: string;
  name: string;
  savedAt: string;
  sfObject: string;
  sfObjectLabel: string;
  selectedFields: string[];        // field names visible in table
  columnFilters: Record<string, string>;      // row filters per column
  columnFilterModes?: Record<string, boolean>; // true = exact match, false/absent = contains
  rowCount: number;                // rows after filters at time of save
  totalCount: number;              // total rows in object
}

export function saveQuery(q: Omit<SavedQuery, "id" | "savedAt">): SavedQuery {
  const entry: SavedQuery = { ...q, id: Date.now().toString(36) + Math.random().toString(36).slice(2), savedAt: new Date().toISOString() };
  const list = [entry, ...loadQueries().filter(x => x.id !== entry.id)].slice(0, MAX_ENTRIES);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  return entry;
}

export function loadQueries(): SavedQuery[] {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
}

export function deleteQuery(id: string) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(loadQueries().filter(q => q.id !== id))); } catch {}
}

export function updateQuery(id: string, updates: Partial<Omit<SavedQuery, "id">>) {
  const list = loadQueries().map((q) => (q.id === id ? { ...q, ...updates } : q));
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}
