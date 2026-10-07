import { useEffect, useState } from "react";
import { FilledButton } from "@neo4j-ndl/react";
import { DataFactory, type Quad } from "n3";
import {
  BASE,
  RECORD,
  applyBridge,
  captureInvariants,
  listMovieTitles,
  movieJsonLd,
  movieWikidata,
  type BridgeRun,
  type Invariants,
} from "../lib/queries";
import { bridge, type BridgeTarget } from "../lib/layers";
import { NS, toTurtle } from "../lib/rdf";
import { CodeBlock, ErrorBanner, LayerViewer, Live, Problem, Punchline, ScenarioFrame, num, useAction } from "./ui";
import { PipelineTable, PragmaticNote } from "./SchemaOrgTab";

const { namedNode, literal, quad } = DataFactory;

interface Output {
  target: BridgeTarget;
  run: BridgeRun;
  text: string;
  language: string;
  before: Invariants;
  after: Invariants;
}

/** n20s.graph.construct returns Jena's short forms: IRIs, bare strings, "v"^^xsd:T. */
function constructToQuads(rows: { subject: string; predicate: string; object: string }[]): Quad[] {
  return rows.map((r) => {
    let o;
    const typed = r.object.match(/^"(.*)"\^\^xsd:(\w+)$/);
    if (typed) o = literal(typed[1], namedNode(NS.xsd + typed[2]));
    else if (/^https?:\/\//.test(r.object)) o = namedNode(r.object);
    else o = literal(r.object);
    return quad(namedNode(r.subject), namedNode(r.predicate), o);
  });
}

export default function WikidataTab() {
  const [titles, setTitles] = useState<string[]>([]);
  const [title, setTitle] = useState("The Matrix");
  const [outputs, setOutputs] = useState<Partial<Record<BridgeTarget, Output>>>({});
  const [pending, setPending] = useState<BridgeTarget | null>(null);

  useEffect(() => {
    listMovieTitles().then(setTitles);
  }, []);

  const run = useAction(async (target: BridgeTarget) => {
    const before = await captureInvariants();
    const r = await applyBridge(target);
    let text: string;
    let language: string;
    if (target === "schemaorg") {
      text = JSON.stringify(await movieJsonLd(title), null, 2);
      language = "JSON-LD · schema.org";
    } else {
      const quads = constructToQuads(await movieWikidata(title));
      const turtle = await toTurtle(quads, {
        e: RECORD,
        wd: NS.wd,
        wdt: NS.wdt,
        p: NS.wp,
        ps: NS.ps,
        pq: NS.pq,
        rdfs: NS.rdfs,
        xsd: NS.xsd,
      });
      // Record IRIs end in an elementId ("4:…:119"): a valid Turtle local name, which n3's writer won't shorten.
      text = turtle.replaceAll(new RegExp(`<${RECORD}([^>]+)>`, "g"), "e:$1");
      language = "Turtle · Wikidata properties";
    }
    const after = await captureInvariants();
    const out: Output = { target, run: r, text, language, before, after };
    setOutputs((o) => ({ ...o, [target]: out }));
    return out;
  });

  const last = run.result;
  const both = outputs.schemaorg && outputs.wikidata;
  const sameGraph = (a: Invariants, b: Invariants) => a.nodes === b.nodes && a.relationships === b.relationships;
  const sameSnap = (a: Invariants, b: Invariants) => a.fingerprint === b.fingerprint;

  return (
    <ScenarioFrame number={3} title="Change the target, not the graph" claim="The bridge is a folder of files. Swap the folder, keep the graph and the snapshot.">
      <Problem title="A new consumer usually means a new pipeline">
        <div className="fanout">
          <div className="fanout-src">Graph</div>
          <div className="fanout-targets">
            <div className="fanout-target">
              schema.org <span className="fanout-cost">export #1</span>
            </div>
            <div className="fanout-target">
              Wikidata <span className="fanout-cost">export #2</span>
            </div>
            <div className="fanout-target">
              next partner <span className="fanout-cost">export #3 …</span>
            </div>
          </div>
        </div>
        <p>
          Each target vocabulary gets its own code, sometimes its own copy of the data, sometimes a remodelled graph. The
          cost grows with every consumer, and so does the risk of touching the source.
        </p>
      </Problem>

      <Live title="Same scope, same snapshot, another bridge folder">
        <PragmaticNote />
        <div className="button-group">
          <select className="select" value={title} onChange={(e) => setTitle(e.target.value)}>
            {titles.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {(["schemaorg", "wikidata"] as BridgeTarget[]).map((t) => (
            <FilledButton
              key={t}
              data-testid={`bridge-${t}`}
              onClick={() => {
                setPending(t);
                run.run(t);
              }}
              isLoading={run.running && pending === t}
              isDisabled={run.running}
            >
              Bridge: bridge/{t}/
            </FilledButton>
          ))}
        </div>
        <ErrorBanner error={run.error} />

        {last && (
          <div className="invariants" data-testid={`invariants-${last.target}`}>
            <Invariant label="Database" ok={sameGraph(last.before, last.after)} value={`${num(last.after.nodes)} nodes · ${num(last.after.relationships)} relationships`} />
            <Invariant
              label="Snapshot"
              ok={sameSnap(last.before, last.after)}
              value={`${num(last.after.snapshotTriples)} triples · sha256 ${last.after.fingerprint.slice(0, 12)}…`}
            />
            <Invariant label="Output" ok changed value={`${bridge(last.target).label} (${last.run.steps.length} pipeline steps)`} />
          </div>
        )}
        {both && (
          <Punchline testid="fingerprint-punchline">
            Two targets, one snapshot: the fingerprints match (
            <code>{outputs.schemaorg!.after.fingerprint.slice(0, 12)}…</code> ={" "}
            <code>{outputs.wikidata!.after.fingerprint.slice(0, 12)}…</code>
            ). Only the bridge folder changed.
          </Punchline>
        )}

        <div className="outputs-split">
          {(["schemaorg", "wikidata"] as BridgeTarget[]).map((t) => {
            const o = outputs[t];
            return (
              <div key={t} className="output-col">
                <div className="consumer-title">{bridge(t).label}</div>
                {o ? (
                  <>
                    <CodeBlock code={o.text} language={o.language} maxHeight={460} />
                    <details>
                      <summary>Pipeline</summary>
                      <PipelineTable run={o.run} />
                    </details>
                  </>
                ) : (
                  <div className="graph-empty output-empty">Run the {bridge(t).label} bridge</div>
                )}
              </div>
            );
          })}
        </div>

        <h4>The two bridge folders (read-only)</h4>
        <div className="outputs-split">
          {(["schemaorg", "wikidata"] as BridgeTarget[]).map((t) => {
            const b = bridge(t);
            return (
              <div key={t} className="output-col">
                <LayerViewer files={[b.axioms, b.rules, ...b.constructs]} />
              </div>
            );
          })}
        </div>
        <div className="hint-row muted">
          Base IRI of the snapshot: <code>{BASE}</code>. Wikidata dates are given at year precision (<code>xsd:gYear</code>);
          REVIEWED and FOLLOWS have no Wikidata property and are left out by the bridge, on purpose.
        </div>
      </Live>
    </ScenarioFrame>
  );
}

function Invariant({ label, ok, value, changed }: { label: string; ok: boolean; value: string; changed?: boolean }) {
  return (
    <div className={`invariant ${changed ? "changed" : ok ? "same" : "diff"}`}>
      <div className="invariant-label">{label}</div>
      <div className="invariant-verdict">{changed ? "changed ↻" : ok ? "unchanged ✓" : "changed ✗"}</div>
      <div className="invariant-value">{value}</div>
    </div>
  );
}
