import { useState } from "react";
import { FilledButton } from "@neo4j-ndl/react";
import {
  BASE,
  SCOPES,
  fetchElements,
  oneSnapshotTwoConsumers,
  recordTriples,
  type GraphNode,
  type GraphRel,
  type SnapshotRecord,
} from "../lib/queries";
import { shorten } from "../lib/rdf";
import { withGroup } from "../lib/neo4j";
import GraphView from "./GraphView";
import { CodeBlock, ErrorBanner, Live, Problem, Punchline, ScenarioFrame, Stat, download, ms, num, useAction } from "./ui";

export default function SnapshotTab() {
  const [preset, setPreset] = useState(SCOPES[0].id);
  const [scope, setScope] = useState(SCOPES[0].cypher);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; rels: GraphRel[] }>({ nodes: [], rels: [] });
  const [selected, setSelected] = useState<SnapshotRecord | null>(null);
  const [triples, setTriples] = useState<{ p: string; o: string }[]>([]);

  const run = useAction(async (s: string) => {
    setSelected(null);
    setTriples([]);
    const r = await oneSnapshotTwoConsumers(s);
    setGraph(await fetchElements(r.records.map((x) => x.elementId)));
    return r;
  });

  const inspect = async (rec: SnapshotRecord) => {
    setSelected(rec);
    setTriples(await withGroup(`Inspect record ${rec.elementId}`, () => recordTriples("s1_snapshot", rec.iri)));
  };

  const r = run.result;
  const presetInfo = SCOPES.find((s) => s.id === preset);

  return (
    <ScenarioFrame number={1} title="One snapshot, two consumers" claim="The scope is a Cypher query. Everything downstream reads the same records.">
      <Problem title="Two exports, two mappings, two truths">
        <div className="drift">
          <div className="drift-src">Graph</div>
          <div className="drift-branches">
            <div className="drift-branch">
              <span className="drift-arrow">→ ETL mapping A →</span>
              <span className="drift-box">Triple store</span>
            </div>
            <div className="drift-branch">
              <span className="drift-arrow">→ ETL mapping B →</span>
              <span className="drift-box">Reasoner</span>
            </div>
          </div>
          <div className="drift-neq">≠</div>
        </div>
        <p>
          Every RDF consumer gets its own hand-written export. The mappings drift, the counts stop matching, and nobody can
          say which records an inference came from.
        </p>
      </Problem>

      <Live title="One Cypher scope → rdfsnapshot.export (TriG file) and n20s.graph.projectSnapshot (in memory)">
        <div className="preset-row">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              className={`preset ${preset === s.id ? "active" : ""}`}
              onClick={() => {
                setPreset(s.id);
                setScope(s.cypher);
                run.run(s.cypher);
              }}
            >
              <code>{s.label}</code>
            </button>
          ))}
        </div>
        <textarea className="cypher-input" value={scope} onChange={(e) => setScope(e.target.value)} rows={4} spellCheck={false} />
        <div className="button-group">
          <FilledButton onClick={() => run.run(scope)} isLoading={run.running}>
            Export and project this scope
          </FilledButton>
        </div>
        <ErrorBanner error={run.error} />

        {r && (
          <>
            {presetInfo && scope === presetInfo.cypher && <div className="scope-rule">{presetInfo.rule}</div>}
            <div className="two-consumers">
              <div className="consumer">
                <div className="consumer-title">rdfsnapshot.export → TriG</div>
                <div className="scenario-summary">
                  <Stat value={r.exported.nodes} label="node records" />
                  <Stat value={r.exported.relationships} label="relationship records" />
                  <Stat value={num(r.exported.quads)} label="quads" />
                  <Stat value={ms(r.exported.ms)} label="export" />
                </div>
              </div>
              <div className="consumer">
                <div className="consumer-title">n20s.graph.projectSnapshot → in memory</div>
                <div className="scenario-summary">
                  <Stat value={r.projected.nodes} label="node records" />
                  <Stat value={r.projected.relationships} label="relationship records" />
                  <Stat value={num(r.projected.triplesAfter)} label="triples" />
                  <Stat value={ms(r.projected.ms)} label="projection" />
                </div>
              </div>
            </div>
            <Punchline>
              Same scope, same records, same counts:{" "}
              {r.exported.nodes === r.projected.nodes && r.exported.relationships === r.projected.relationships
                ? "✓ the file and the reasoner agree."
                : "✗ mismatch!"}{" "}
              The Benchmark tab proves it triple by triple.
            </Punchline>

            <GraphView
              nodes={graph.nodes}
              rels={graph.rels}
              highlight={selected ? new Set([selected.elementId]) : undefined}
              onSelect={(id) => {
                const rec = r.records.find((x) => x.elementId === id);
                if (rec) inspect(rec);
              }}
              emptyHint="No records in scope"
            />

            <div className="records-split">
              <div className="records-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Record</th>
                      <th>lpg:label / lpg:type</th>
                      <th>elementId</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.records.map((rec) => (
                      <tr key={rec.iri} className={selected?.iri === rec.iri ? "selected" : ""} onClick={() => inspect(rec)}>
                        <td>
                          <span className={`kind-chip ${rec.kind}`}>{rec.kind === "Node" ? "node" : "relationship"}</span>{" "}
                          {rec.display ||
                            `${shortName(r.records, rec.source)} → ${shortName(r.records, rec.target)}`}
                        </td>
                        <td>
                          <code>{rec.kind === "Node" ? "l:" : "t:"}{rec.labelOrType}</code>
                        </td>
                        <td className="mono small">{rec.elementId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="record-inspector">
                {selected ? (
                  <>
                    <div className="inspector-title">
                      <code>{shorten(selected.iri, BASE)}</code>
                    </div>
                    {selected.kind === "Relationship" && (
                      <div className="inspector-note">
                        A relationship is a resource: it has its own IRI, its type, its endpoints and its properties. This is
                        what lets a bridge say "this ACTED_IN record <em>is</em> a PerformanceRole".
                      </div>
                    )}
                    <table className="triples-table">
                      <tbody>
                        {triples.map((t, i) => (
                          <tr key={i}>
                            <td>
                              <code>{shorten(t.p, BASE)}</code>
                            </td>
                            <td>
                              <code>{shorten(String(t.o), BASE)}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div className="inspector-empty">Click a record (row or graph element) to see its triples, read back from n20s.</div>
                )}
              </div>
            </div>

            <CodeBlock
              code={r.exported.trig}
              language="TriG · rdfsnapshot.export"
              maxHeight={420}
              actions={
                <button className="audit-btn" onClick={() => download("movies-snapshot.trig", r.exported.trig, "application/trig")}>
                  Download .trig
                </button>
              }
            />
          </>
        )}
      </Live>
    </ScenarioFrame>
  );
}

function shortName(records: SnapshotRecord[], iri?: string): string {
  return records.find((x) => x.iri === iri)?.display ?? "?";
}
