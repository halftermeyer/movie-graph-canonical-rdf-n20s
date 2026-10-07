import { useMemo, useState } from "react";
import { FilledButton, OutlinedButton } from "@neo4j-ndl/react";
import {
  BACON_SCOPE,
  BASE,
  compareBacon,
  cypherBaconNumbers,
  elementIdOf,
  explainBacon,
  fetchElements,
  prepareProofGraph,
  proofElementIds,
  rdfBaconBounds,
  recordIri,
  testOwlProfiles,
  type BaconComparison,
  type GraphNode,
  type GraphRel,
  type Proof,
} from "../lib/queries";
import { RULES } from "../lib/layers";
import { shorten } from "../lib/rdf";
import { withGroup } from "../lib/neo4j";
import GraphView from "./GraphView";
import { CodeBlock, ErrorBanner, LayerViewer, Live, Problem, Punchline, ScenarioFrame, Stat, ms, num, useAction } from "./ui";

export default function BaconTab() {
  const [filter, setFilter] = useState("");
  const [proof, setProof] = useState<Proof | null>(null);
  const [proofGraph, setProofGraph] = useState<{ nodes: GraphNode[]; rels: GraphRel[] }>({ nodes: [], rels: [] });
  const [focus, setFocus] = useState<string | null>(null);
  const [proofFor, setProofFor] = useState<BaconComparison | null>(null);

  const cypher = useAction(() => withGroup("Closed world: Cypher shortest paths", () => cypherBaconNumbers()));
  const profiles = useAction(() => testOwlProfiles());
  const ladder = useAction((method: "rules" | "owl") => rdfBaconBounds(method, "OWL_MICRO"));
  const explain = useAction(async (row: BaconComparison) => {
    setProofFor(row);
    setFocus(null);
    await prepareProofGraph();
    const p = await explainBacon(recordIri(row.elementId), row.rdf ?? row.cypher);
    setProof(p);
    setProofGraph(await withGroup("Back to Neo4j by elementId", () => fetchElements(proofElementIds(p))));
    return p;
  });

  const table = useMemo(
    () => (cypher.result && ladder.result ? compareBacon(cypher.result, ladder.result.bounds) : null),
    [cypher.result, ladder.result]
  );
  const agree = table?.filter((r) => r.rdf === r.cypher).length ?? 0;
  const dist = useMemo(() => {
    const d: number[] = [];
    cypher.result?.forEach((r) => (d[r.baconNumber] = (d[r.baconNumber] ?? 0) + 1));
    return d;
  }, [cypher.result]);

  const order = proof
    ? proof.hops.flatMap((h, i) => (i === 0 ? [h.from, h.movie, h.to] : [h.movie, h.to])).map((iri) => elementIdOf(iri)!)
    : undefined;
  const names = new Map(proofGraph.nodes.map((n) => [n.id, n.label]));
  const label = (iri: string) => names.get(elementIdOf(iri) ?? "") ?? shorten(iri, BASE);

  return (
    <ScenarioFrame number={4} title="Six degrees, proven" claim="Cypher measures. RDF proves. They answer different questions.">
      <Problem title="“Is she within two hops of Kevin Bacon? Prove it.”">
        <div className="ladder-visual">
          {[6, 5, 4, 3, 2, 1, 0].map((k) => (
            <div key={k} className={`rung rung-${k}`}>
              <span>within {k}</span>
            </div>
          ))}
          <div className="ladder-legend">
            Each rung contains the one below. Being on rung 2 says “at most 2”, never “exactly 2”.
          </div>
        </div>
        <p>
          A number alone is not evidence: a reviewer wants the chain of films behind it, down to the database records. And a
          reasoner that says “within 2” must not be read as “the distance is 2”.
        </p>
      </Problem>

      <Live title="Scope with the Movie Graph guide's Bacon query, derive with RDF, compare">
        <CodeBlock code={BACON_SCOPE} language="Cypher · the scope (shortestPath, up to 4 co-star hops)" maxHeight={140} />
        <div className="button-group">
          <FilledButton onClick={() => cypher.run()} isLoading={cypher.running}>
            1 · Cypher: exact Bacon numbers
          </FilledButton>
          <FilledButton onClick={() => profiles.run()} isLoading={profiles.running}>
            2 · Which profile fires the OWL ladder?
          </FilledButton>
          <FilledButton onClick={() => ladder.run("rules")} isLoading={ladder.running}>
            3 · RDF: derive coStar + the ladder
          </FilledButton>
          {ladder.result && (
            <OutlinedButton onClick={() => ladder.run(ladder.result!.method === "rules" ? "owl" : "rules")} isDisabled={ladder.running}>
              Run it with {ladder.result.method === "rules" ? "the OWL definition (OWL_MICRO)" : "the Jena rules"}
            </OutlinedButton>
          )}
        </div>
        <ErrorBanner error={cypher.error ?? profiles.error ?? ladder.error} />

        {cypher.result && (
          <div className="dist">
            <div className="consumer-title">Closed world · Cypher shortestPath over the whole graph</div>
            <div className="dist-bars">
              {dist.map((n, k) => (
                <div key={k} className="dist-bar">
                  <div className="dist-fill" style={{ height: `${(100 * (n ?? 0)) / Math.max(...dist.map((x) => x ?? 0))}%` }} />
                  <div className="dist-n">{n ?? 0}</div>
                  <div className="dist-k">exactly {k}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {profiles.result && (
          <div className="profiles">
            <div className="consumer-title">rules/bacon-ladder.owl.ttl (∃ coStar . BaconWithin<sub>k</sub> ⊑ BaconWithin<sub>k+1</sub>) under each profile</div>
            <div className="profile-row">
              {profiles.result.map((p) => (
                <div key={p.profile} className={`profile ${p.status}`}>
                  <div className="profile-name">{p.profile}</div>
                  <div className="profile-status">
                    {p.status === "fired" ? "fires ✓" : p.status === "silent" ? "silent" : p.status === "timeout" ? "too slow" : "error"}
                  </div>
                  <div className="profile-detail">
                    {p.status === "fired" ? `${p.members} people on rung 1 · ${ms(p.ms)}` : p.error ?? `${ms(p.ms)}, no rung-1 member`}
                  </div>
                </div>
              ))}
            </div>
            <div className="hint-row muted">
              coStar is materialized first (rules/costar.rules): a profile does not see facts that rules stacked on top of it
              derive. The executable fallback, <code>rules/bacon-ladder.rules</code>, is one Jena rule per rung; it is also what
              <code> n20s.graph.explain</code> replays for proofs.
            </div>
          </div>
        )}

        {ladder.result && (
          <div className="scenario-summary">
            <Stat value={ladder.result.method === "rules" ? "Jena rules" : `OWL · ${ladder.result.profile}`} label="method" />
            <Stat value={num(ladder.result.scope.nodes)} label="node records in scope" />
            <Stat value={num(ladder.result.newTriples)} label="derived triples" />
            <Stat value={ms(ladder.result.ms)} label="reasoning" />
          </div>
        )}

        {table && (
          <>
            <Punchline>
              <span className="punch-big">RDF proves “within 2”. Only Cypher knows “exactly 2”.</span>
              <br />
              Open world: from the triples, the reasoner can derive that someone is <em>within</em> k, never that they are{" "}
              <em>not</em> within k−1, because a missing co-star triple is not proof that the co-star does not exist. The
              tightest bound below is the smallest rung we find among the derived facts. Here it matches Cypher's exact number
              for <strong>{agree} of {table.length}</strong> people. That is a check we run, not something RDF computes.
            </Punchline>
            <input className="filter-input" placeholder="Filter people…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="records-table-wrap tall">
              <table className="data-table bacon-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Cypher: exactly</th>
                    <th>RDF: within (tightest bound)</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {table
                    .filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
                    .map((r) => (
                      <tr key={r.elementId} className={proofFor?.elementId === r.elementId ? "selected" : ""}>
                        <td>{r.name}</td>
                        <td>
                          <span className="exact">= {r.cypher}</span>
                        </td>
                        <td>
                          {r.rdf === null ? <span className="muted">no rung derived</span> : <span className="bound">≤ {r.rdf}</span>}
                        </td>
                        <td>{r.rdf === r.cypher ? "✓" : "✗"}</td>
                        <td>
                          {r.cypher > 0 && (
                            <button className="audit-btn" onClick={() => explain.run(r)} disabled={explain.running}>
                              Prove “within {r.rdf ?? r.cypher}”
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <ErrorBanner error={explain.error} />
        {proof && proofFor && (
          <div className="proof">
            <div className="consumer-title">
              n20s.graph.explain: {proofFor.name} is BaconWithin{proof.rung}, {proof.steps.length} derivation steps
            </div>
            <div className="proof-path">
              {proof.hops.map((h, i) => (
                <div key={i} className="proof-hop">
                  {i === 0 && <ProofChip kind="Person" label={label(h.from)} iri={h.from} focus={focus} onFocus={setFocus} />}
                  <ProofChip kind="rel" label={`ACTED_IN`} iri={h.via[0]} focus={focus} onFocus={setFocus} />
                  <ProofChip kind="Movie" label={label(h.movie)} iri={h.movie} focus={focus} onFocus={setFocus} />
                  <ProofChip kind="rel" label={`ACTED_IN`} iri={h.via[1]} focus={focus} onFocus={setFocus} />
                  <ProofChip kind="Person" label={label(h.to)} iri={h.to} focus={focus} onFocus={setFocus} />
                  <span className="proof-rule">⇒ coStar · rung {proof.rung - i - 1 === 0 ? "0 (Kevin Bacon)" : proof.rung - i - 1}</span>
                </div>
              ))}
            </div>
            <GraphView
              nodes={proofGraph.nodes}
              rels={proofGraph.rels}
              order={order}
              highlight={focus ? new Set([focus]) : undefined}
              onSelect={(id) => setFocus(id === focus ? null : id)}
              height={300}
            />
            {focus && (
              <div className="focus-line">
                Selected record <code>{focus}</code>. In Neo4j:{" "}
                <code>
                  {focus.startsWith("5:")
                    ? `MATCH ()-[r]->() WHERE elementId(r) = '${focus}' RETURN r`
                    : `MATCH (n) WHERE elementId(n) = '${focus}' RETURN n`}
                </code>
              </div>
            )}
            <details>
              <summary>Raw derivation trace ({proof.steps.length} steps)</summary>
              <table className="data-table small">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Statement</th>
                    <th>Kind</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {proof.steps.map((s) => (
                    <tr key={s.step}>
                      <td>{s.step}</td>
                      <td className="mono" style={{ paddingLeft: 8 + s.depth * 18 }}>
                        {shorten(s.subject, BASE)} {shorten(s.predicate, BASE)} {shorten(s.object, BASE)}
                      </td>
                      <td>{s.kind}</td>
                      <td>{s.rule}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}

        <h4>The layers this scenario used (read-only)</h4>
        <LayerViewer files={[RULES.coStar, RULES.baconOwl, RULES.baconRules]} />
      </Live>
    </ScenarioFrame>
  );
}

function ProofChip({
  kind,
  label,
  iri,
  focus,
  onFocus,
}: {
  kind: "Person" | "Movie" | "rel";
  label: string;
  iri: string;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  const id = elementIdOf(iri) ?? iri;
  return (
    <button
      className={`proof-chip ${kind} ${focus === id ? "on" : ""}`}
      onClick={() => onFocus(focus === id ? null : id)}
      title={`elementId ${id}`}
    >
      {label}
      <span className="proof-eid">{id.split(":").pop()}</span>
    </button>
  );
}
