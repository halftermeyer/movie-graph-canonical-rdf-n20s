import { useState } from "react";
import { FilledButton } from "@neo4j-ndl/react";
import { BENCHMARK_SCOPES, runParityBenchmark, type BenchmarkResult } from "../lib/queries";
import { ErrorBanner, Live, Problem, Punchline, ScenarioFrame, Stat, ms, num, useAction } from "./ui";

export default function BenchmarkTab() {
  const [scopeId, setScopeId] = useState(BENCHMARK_SCOPES[0].id);
  const [scope, setScope] = useState(BENCHMARK_SCOPES[0].cypher);
  const [history, setHistory] = useState<(BenchmarkResult & { label: string })[]>([]);

  const run = useAction(async () => {
    const r = await runParityBenchmark(scope);
    const label = BENCHMARK_SCOPES.find((s) => s.cypher === scope)?.label ?? "custom scope";
    setHistory((h) => [{ ...r, label }, ...h].slice(0, 12));
    return r;
  });
  const r = run.result;

  return (
    <ScenarioFrame number="⚖" title="Parity, on the spot" claim="The file and the reasoner hold the same graph. Check it now, on any scope.">
      <Problem title="“Is the in-memory graph really the same as the export?”">
        <p>
          Two code paths serialize the snapshot: <code>rdfsnapshot.export</code> writes TriG, and{" "}
          <code>n20s.graph.projectSnapshot</code> fills a Jena model. If they ever disagree, a reasoning result can't be traced
          back to the published file. So this check runs live: same scope, same snapshot id, then an RDF graph isomorphism
          check (blank nodes included), ignoring only <code>prov:generatedAtTime</code>.
        </p>
      </Problem>
      <Live title="Export ‖ projection ‖ isomorphism">
        <div className="preset-row">
          {BENCHMARK_SCOPES.map((s) => (
            <button
              key={s.id}
              data-testid={`bench-scope-${s.id}`}
              className={`preset ${scopeId === s.id ? "active" : ""}`}
              onClick={() => {
                setScopeId(s.id);
                setScope(s.cypher);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <textarea className="cypher-input" value={scope} onChange={(e) => { setScope(e.target.value); setScopeId("custom"); }} rows={5} spellCheck={false} />
        <div className="button-group">
          <FilledButton onClick={() => run.run()} isLoading={run.running} data-testid="bench-run">
            Run export + projection + isomorphism check
          </FilledButton>
        </div>
        <ErrorBanner error={run.error} />
        {r && (
          <>
            <div className="two-consumers">
              <div className="consumer">
                <div className="consumer-title">rdfsnapshot.export</div>
                <div className="scenario-summary">
                  <Stat value={ms(r.export.ms)} label="export (incl. transfer)" />
                  <Stat value={num(r.export.triples)} label="triples" />
                  <Stat value={`${(r.export.bytes / 1024).toFixed(0)} KB`} label="TriG" />
                </div>
              </div>
              <div className="consumer">
                <div className="consumer-title">n20s.graph.projectSnapshot</div>
                <div className="scenario-summary">
                  <Stat value={ms(r.project.ms)} label="projection" />
                  <Stat value={num(r.project.triples)} label="triples" />
                  <Stat value={ms(r.project.readBackMs)} label="read back for the check" />
                </div>
              </div>
            </div>
            <div className="scenario-summary">
              <Stat value={r.isomorphic ? "isomorphic ✓" : "different ✗"} label={`${num(r.compared)} triples compared · ${ms(r.checkMs)}`} tone={r.isomorphic ? "good" : "bad"} testid="bench-result" />
            </div>
            {r.diff && (
              <pre className="blocking-error">
                {"Only in export:\n" + r.diff.onlyA.join("\n") + "\n\nOnly in projection:\n" + r.diff.onlyB.join("\n")}
              </pre>
            )}
            {r.isomorphic && (
              <Punchline>
                One spec, two implementations, one graph. Snapshot id <code>{r.snapshotId}</code> was forced on both sides so
                the snapshot IRIs match; <code>prov:generatedAtTime</code> is the only triple ignored.
              </Punchline>
            )}
          </>
        )}
        {history.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th style={{ textAlign: "right" }}>Triples</th>
                <th style={{ textAlign: "right" }}>Export</th>
                <th style={{ textAlign: "right" }}>Projection</th>
                <th>Isomorphic</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.label}</td>
                  <td style={{ textAlign: "right" }}>{num(h.export.triples)}</td>
                  <td style={{ textAlign: "right" }}>{ms(h.export.ms)}</td>
                  <td style={{ textAlign: "right" }}>{ms(h.project.ms)}</td>
                  <td>{h.isomorphic ? "✓" : "✗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Live>
    </ScenarioFrame>
  );
}
