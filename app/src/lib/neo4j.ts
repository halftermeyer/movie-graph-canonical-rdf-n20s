import neo4j, { Driver, Session, Record as Neo4jRecord, type Integer } from "neo4j-driver";

let driver: Driver | null = null;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      import.meta.env.NEO4J_URI || "bolt://127.0.0.1:7687",
      neo4j.auth.basic(
        import.meta.env.NEO4J_USER || "neo4j",
        import.meta.env.NEO4J_PASSWORD || ""
      )
    );
  }
  return driver;
}

// ── Query audit log ────────────────────────────────────────────

export interface QueryLogEntry {
  id: number;
  timestamp: Date;
  cypher: string;
  params: Record<string, unknown>;
  durationMs: number;
  rowCount: number;
  results?: unknown[];
  error?: string;
  group?: string;
}

export interface QueryGroup {
  label: string;
  entries: QueryLogEntry[];
  totalMs: number;
  totalRows: number;
  hasError: boolean;
}

let _logCounter = 0;
let _queryLog: QueryLogEntry[] = [];
let _currentGroup: string | null = null;
const _listeners: Set<() => void> = new Set();

export function getQueryLog(): QueryLogEntry[] {
  return _queryLog;
}

/** Push an external log entry (used for server-mode HTTP calls) */
export function pushLogEntry(entry: Omit<QueryLogEntry, "id">): void {
  _queryLog = [..._queryLog, { ...entry, id: ++_logCounter, group: entry.group || _currentGroup || undefined }];
  _notifyListeners();
}

/** Group subsequent queries under a label until endGroup() is called */
export function beginGroup(label: string): void {
  _currentGroup = label;
}

export function endGroup(): void {
  _currentGroup = null;
}

/** Run an async function with all its queries grouped under a label */
export async function withGroup<T>(label: string, fn: () => Promise<T>): Promise<T> {
  beginGroup(label);
  try {
    return await fn();
  } finally {
    endGroup();
  }
}

/** Return log entries organized into groups (ungrouped entries get their own group) */
export function getGroupedLog(): QueryGroup[] {
  const groups: QueryGroup[] = [];
  let currentLabel: string | null = null;
  let currentEntries: QueryLogEntry[] = [];

  const flush = () => {
    if (currentEntries.length > 0) {
      groups.push({
        label: currentLabel || currentEntries[0].cypher.split("\n")[0].trim().substring(0, 60),
        entries: currentEntries,
        totalMs: currentEntries.reduce((s, e) => s + e.durationMs, 0),
        totalRows: currentEntries.reduce((s, e) => s + e.rowCount, 0),
        hasError: currentEntries.some((e) => e.error),
      });
      currentEntries = [];
    }
  };

  for (const entry of _queryLog) {
    if (entry.group !== currentLabel) {
      flush();
      currentLabel = entry.group || null;
    }
    currentEntries.push(entry);
  }
  flush();

  return groups;
}

export function clearQueryLog(): void {
  _queryLog = [];
  _notifyListeners();
}

export function onQueryLogChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notifyListeners() {
  _listeners.forEach((fn) => fn());
}

// ── Run query with logging ─────────────────────────────────────

export const DATABASE: string = import.meta.env.NEO4J_DATABASE || "neo4j";

export async function closeDriver(): Promise<void> {
  if (driver) await driver.close();
  driver = null;
}

export interface RunOptions {
  /** Server-side transaction timeout; the transaction is terminated past it. */
  timeoutMs?: number;
}

export async function runQuery<T = Record<string, unknown>>(
  cypher: string,
  params: Record<string, unknown> = {},
  options: RunOptions = {}
): Promise<T[]> {
  const session: Session = getDriver().session({ database: DATABASE });
  const start = performance.now();
  const entryId = ++_logCounter;

  try {
    const result = await session.run(
      cypher,
      params,
      options.timeoutMs ? { timeout: options.timeoutMs } : undefined
    );
    const rows = result.records.map((r: Neo4jRecord) => {
      const obj: Record<string, unknown> = {};
      r.keys.forEach((key) => {
        const val = r.get(key);
        obj[key as string] = toJS(val);
      });
      return obj as T;
    });

    _queryLog = [
      ..._queryLog,
      {
        id: entryId,
        timestamp: new Date(),
        cypher: cypher.trim(),
        params,
        durationMs: Math.round(performance.now() - start),
        rowCount: rows.length,
        results: rows.slice(0, 20).map(truncateRow) as unknown[],
        group: _currentGroup || undefined,
      },
    ];
    _notifyListeners();

    return rows;
  } catch (e: unknown) {
    _queryLog = [
      ..._queryLog,
      {
        id: entryId,
        timestamp: new Date(),
        cypher: cypher.trim(),
        params,
        durationMs: Math.round(performance.now() - start),
        rowCount: 0,
        error: (e as Error).message,
        group: _currentGroup || undefined,
      },
    ];
    _notifyListeners();
    throw e;
  } finally {
    await session.close();
  }
}

// Keep the log light: long strings (TriG, Turtle) are clipped in the drawer.
function truncateRow(row: unknown): unknown {
  if (typeof row === "string") return row.length > 2000 ? row.slice(0, 2000) + "…" : row;
  if (Array.isArray(row)) return row.slice(0, 50).map(truncateRow);
  if (row && typeof row === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k] = truncateRow(v);
    return out;
  }
  return row;
}

// Convert Neo4j types to plain JS
function toJS(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (neo4j.isInt(val)) return val.toNumber();
  if (typeof val === "object" && val !== null) {
    if (Array.isArray(val)) return val.map(toJS);
    if ("low" in val && "high" in val) return neo4j.integer.toNumber(val as Integer);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = toJS(v);
    }
    return out;
  }
  return val;
}
