const HISTORY_KEY = "salesforce_query_history_v1";
const MAX_ENTRIES = 20;

export interface SfQueryRecord {
  id: string;
  savedAt: string;
  // Source 1
  obj1Name: string;
  obj1Label: string;
  obj1RowCount: number;
  obj1Fields: string[];
  // Source 2
  obj2Name: string;
  obj2Label: string;
  obj2RowCount: number;
  // Join
  joinField1: string;
  joinField2: string;
  matchCount: number;
  // Output
  destKey: string;
  destLabel: string;
  outputRowCount: number;
  outputColCount: number;
}

export function saveQueryRecord(record: Omit<SfQueryRecord, "id" | "savedAt">) {
  const history = loadHistory();
  const entry: SfQueryRecord = {
    ...record,
    id: Date.now().toString(36),
    savedAt: new Date().toISOString(),
  };
  const updated = [entry, ...history].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
  return entry;
}

export function loadHistory(): SfQueryRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function deleteRecord(id: string) {
  const updated = loadHistory().filter(r => r.id !== id);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
