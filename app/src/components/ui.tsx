// Small shared building blocks: scenario frame, problem statement, stats,
// code blocks, read-only layer viewer, and an action hook.

import { useCallback, useState, type ReactNode } from "react";
import { Banner } from "@neo4j-ndl/react";
import type { LayerFile } from "../lib/layers";

export function useAction<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const run = useCallback(
    async (...args: A) => {
      setRunning(true);
      setError(null);
      try {
        const r = await fn(...args);
        setResult(r);
        return r;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [fn]
  );
  return { run, running, error, result, setResult };
}

export function ScenarioFrame({
  number,
  title,
  claim,
  children,
}: {
  number: number | string;
  title: string;
  claim: string;
  children: ReactNode;
}) {
  return (
    <div className="scenario-card">
      <div className="scenario-header">
        <div className="scenario-number">{number}</div>
        <div>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <div className="scenario-claim">{claim}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The business problem, stated visually before anything runs. */
export function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="problem" data-testid="problem">
      <div className="problem-label">The problem</div>
      <div className="problem-title">{title}</div>
      <div className="problem-body">{children}</div>
    </div>
  );
}

export function Live({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="live">
      <div className="live-label">Live</div>
      <div className="live-title">{title}</div>
      {children}
    </div>
  );
}

export function Punchline({ children, testid }: { children: ReactNode; testid?: string }) {
  return (
    <div className="punchline" data-testid={testid}>
      {children}
    </div>
  );
}

export function Stat({
  value,
  label,
  tone,
  testid,
}: {
  value: ReactNode;
  label: string;
  tone?: "good" | "bad" | "neutral";
  testid?: string;
}) {
  return (
    <div className={`scenario-stat ${tone ?? ""}`} data-testid={testid}>
      <div className="stat-number">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Banner variant="danger" isCloseable={false}>
      {error}
    </Banner>
  );
}

export function CodeBlock({
  code,
  maxHeight = 360,
  language,
  actions,
  testid,
}: {
  code: string;
  maxHeight?: number;
  language?: string;
  actions?: ReactNode;
  testid?: string;
}) {
  return (
    <div className="code-block" data-testid={testid}>
      <div className="code-block-bar">
        <span className="code-lang">{language ?? ""}</span>
        <span style={{ display: "flex", gap: 6 }}>
          {actions}
          <button className="audit-btn" onClick={() => navigator.clipboard.writeText(code)}>
            Copy
          </button>
        </span>
      </div>
      <pre style={{ maxHeight }}>{code}</pre>
    </div>
  );
}

export function download(filename: string, content: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read-only view of declarative layer files. */
export function LayerViewer({ files, title }: { files: LayerFile[]; title?: string }) {
  const [active, setActive] = useState(0);
  const file = files[Math.min(active, files.length - 1)];
  if (!file) return null;
  return (
    <div className="layer-viewer">
      <div className="layer-tabs">
        {title && <span className="layer-title">{title}</span>}
        {files.map((f, i) => (
          <button
            key={f.path}
            className={`layer-tab ${i === active ? "active" : ""} ${f.kind}`}
            onClick={() => setActive(i)}
            title={f.path}
          >
            {f.path}
          </button>
        ))}
        <span className="layer-readonly">read-only</span>
      </div>
      <pre className="layer-content">{file.content}</pre>
    </div>
  );
}

export function ms(n: number): string {
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`;
}

export function num(n: number): string {
  return n.toLocaleString("en-US");
}
