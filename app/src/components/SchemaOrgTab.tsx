import { useEffect, useState } from "react";
import { FilledButton, OutlinedButton } from "@neo4j-ndl/react";
import {
  BASE,
  applyBridge,
  describeIri,
  listMovieTitles,
  movieJsonLd,
  validateSchemaOrg,
  type BridgeRun,
  type Violation,
} from "../lib/queries";
import { bridge, RULES, SHAPES } from "../lib/layers";
import { shorten } from "../lib/rdf";
import { withGroup } from "../lib/neo4j";
import { CodeBlock, ErrorBanner, LayerViewer, Live, Problem, Punchline, ScenarioFrame, Stat, download, ms, num, useAction } from "./ui";

const B = bridge("schemaorg");
const YEARS = "bridge/schemaorg/01-years.rq";

export function PragmaticNote() {
  return (
    <div className="pragmatic-note">
      <strong>Pragmatic route.</strong> This bridge treats a <code>:Movie</code> record as a movie: the record IRI stands for
      the film itself. The snapshot spec keeps <em>record ≠ thing</em> (a lifting step would mint separate IRIs for the
      things and link them to the records). Fine for a demo and for most catalogues; know that it is a choice.
    </div>
  );
}

export function PipelineTable({ run, testid }: { run: BridgeRun; testid?: string }) {
  return (
    <table className="data-table pipeline" data-testid={testid}>
      <thead>
        <tr>
          <th>Step</th>
          <th>File / procedure</th>
          <th style={{ textAlign: "right" }}>Triples after</th>
          <th style={{ textAlign: "right" }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {run.steps.map((s, i) => (
          <tr key={i} className={s.step.includes("skipped") ? "skipped" : ""}>
            <td>{s.step}</td>
            <td>
              <code>{s.detail}</code>
            </td>
            <td style={{ textAlign: "right" }}>{num(s.triplesAfter)}</td>
            <td style={{ textAlign: "right" }}>{ms(s.ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SchemaOrgTab() {
  const [titles, setTitles] = useState<string[]>([]);
  const [title, setTitle] = useState("The Matrix");
  const [breakIt, setBreakIt] = useState(false);
  const [role, setRole] = useState<{ iri: string; actor: string; triples: { p: string; o: string }[] } | null>(null);

  useEffect(() => {
    listMovieTitles().then(setTitles);
  }, []);

  const bridgeRun = useAction(async (skip: boolean) => {
    validation.setResult(null);
    ld.setResult(null);
    setRole(null);
    return applyBridge("schemaorg", { skip: skip ? [YEARS] : [] });
  });
  const validation = useAction(() => validateSchemaOrg());
  const ld = useAction(async (t: string) => {
    const doc = await movieJsonLd(t);
    const actors = (doc.actor as { "@id": string; actor: { name: string } }[] | undefined) ?? [];
    if (actors[0]) {
      const triples = await withGroup("The ACTED_IN record, after the bridge", () => describeIri("bridge_schemaorg", actors[0]["@id"]));
      setRole({ iri: actors[0]["@id"], actor: actors[0].actor.name, triples });
    } else setRole(null);
    return doc;
  });

  const v = validation.result;
  const violations = v?.filter((x) => x.severity.includes("Violation")) ?? [];
  const warnings = v?.filter((x) => x.severity.includes("Warning")) ?? [];
  const jsonld = ld.result ? JSON.stringify(ld.result, null, 2) : "";
  const snippet = jsonld ? `<script type="application/ld+json">\n${jsonld}\n</script>` : "";

  return (
    <ScenarioFrame number={2} title="The web speaks schema.org" claim="A declarative bridge turns graph records into what search engines and catalogues read.">
      <Problem title="Your graph knows the movie. Google does not.">
        <div className="serp">
          <div className="serp-card bare">
            <div className="serp-url">movies.example.com › the-matrix</div>
            <div className="serp-title">The Matrix</div>
            <div className="serp-text">No structured data: no year, no rating, no cast, no rich result.</div>
          </div>
          <div className="serp-vs">vs</div>
          <div className="serp-card rich">
            <div className="serp-url">movies.example.com › the-matrix</div>
            <div className="serp-title">The Matrix (1999)</div>
            <div className="serp-stars">★★★★☆ <span>Rating · reviews</span></div>
            <div className="serp-text">Director · Cast · Characters</div>
          </div>
        </div>
        <p>
          The data is in Neo4j, in the graph's own words (<code>:Movie</code>, <code>ACTED_IN.roles</code>,{" "}
          <code>REVIEWED.rating</code>). The consumer wants schema.org. Hand-coding that export per page is the usual answer,
          and it rots.
        </p>
      </Problem>

      <Live title="Bridge → SHACL → JSON-LD, from plain files">
        <PragmaticNote />
        <div className="button-group">
          <FilledButton onClick={() => bridgeRun.run(breakIt)} isLoading={bridgeRun.running} data-testid="apply-bridge">
            1 · Apply the schema.org bridge
          </FilledButton>
          <label className="checkbox">
            <input type="checkbox" data-testid="break-it" checked={breakIt} onChange={(e) => setBreakIt(e.target.checked)} /> Break it: skip{" "}
            <code>01-years.rq</code>
          </label>
        </div>
        <ErrorBanner error={bridgeRun.error} />
        {bridgeRun.result && (
          <PipelineTable
            run={bridgeRun.result}
            testid={bridgeRun.result.steps.some((s) => s.step.includes("skipped")) ? "bridge-run-broken" : "bridge-run-full"}
          />
        )}

        {bridgeRun.result && (
          <div className="button-group">
            <FilledButton onClick={() => validation.run()} isLoading={validation.running} data-testid="validate">
              2 · Validate with SHACL (rules/shapes.ttl)
            </FilledButton>
          </div>
        )}
        <ErrorBanner error={validation.error} />
        {v && (
          <>
            <div className="scenario-summary" data-testid={violations.length ? "shacl-result-broken" : "shacl-result-ok"}>
              <Stat value={violations.length} label="violations" tone={violations.length ? "bad" : "good"} />
              <Stat value={warnings.length} label="warnings" tone="neutral" />
            </div>
            <ViolationList items={[...violations, ...warnings]} />
            {violations.length === 0 ? (
              <Punchline>✓ Every movie, person, role, review and rating has what a schema.org consumer expects.</Punchline>
            ) : (
              <Punchline>
                ✗ The shapes caught it: without the year CONSTRUCT, no movie has a <code>schema:datePublished</code>. Untick
                "Break it" and run the bridge again.
              </Punchline>
            )}
          </>
        )}

        {bridgeRun.result && (
          <div className="button-group">
            <select className="select" data-testid="movie-select" value={title} onChange={(e) => setTitle(e.target.value)}>
              {titles.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <FilledButton onClick={() => ld.run(title)} isLoading={ld.running} data-testid="gen-jsonld">
              3 · Generate the JSON-LD block
            </FilledButton>
          </div>
        )}
        <ErrorBanner error={ld.error} />
        {ld.result && (
          <div className="jsonld-split" data-testid="jsonld-split">
            <CodeBlock
              testid="jsonld-block"
              code={snippet}
              language="HTML · ready to embed"
              maxHeight={520}
              actions={
                <button className="audit-btn" onClick={() => download(`${title}.jsonld`, jsonld, "application/ld+json")}>
                  Download .jsonld
                </button>
              }
            />
            <RichResult doc={ld.result} />
          </div>
        )}

        {role && (
          <div className="resource-callout" data-testid="resource-callout">
            <div className="resource-callout-title">Why relationships are resources</div>
            <p>
              The PerformanceRole of <strong>{role.actor}</strong> has <code>"@id": "{shorten(role.iri, BASE)}"</code>. That is
              the IRI of the <code>ACTED_IN</code> relationship record in the snapshot. No node was invented: the record{" "}
              <em>is</em> the role, so the character name has somewhere to live.
            </p>
            <table className="triples-table">
              <tbody>
                {role.triples.map((t, i) => (
                  <tr key={i} className={t.p.startsWith("https://schema.org/") || String(t.o).startsWith("https://schema.org/") ? "schema" : "lpg"}>
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
            <div className="legend">
              <span className="legend-lpg">snapshot (lpg:, p:)</span> <span className="legend-schema">derived by the bridge (schema:)</span>
            </div>
          </div>
        )}

        <h4>The layers this scenario used (read-only)</h4>
        <LayerViewer files={[B.axioms, B.rules, ...B.constructs, RULES.aggregateRating, RULES.auteur, SHAPES]} />
        <div className="hint-row">
          <OutlinedButton size="small" onClick={() => bridgeRun.run(false)}>
            Re-run the bridge
          </OutlinedButton>
        </div>
      </Live>
    </ScenarioFrame>
  );
}

function ViolationList({ items }: { items: Violation[] }) {
  const groups = new Map<string, { severity: string; n: number; sample: string }>();
  items.forEach((v) => {
    const g = groups.get(v.message) ?? { severity: v.severity, n: 0, sample: v.focusNode ?? "" };
    g.n++;
    groups.set(v.message, g);
  });
  if (groups.size === 0) return null;
  return (
    <table className="data-table">
      <tbody>
        {[...groups.entries()].map(([msg, g]) => (
          <tr key={msg}>
            <td>
              <span className={g.severity.includes("Violation") ? "status-fail" : "status-warn"}>
                {g.severity.split("#").pop()}
              </span>
            </td>
            <td>{msg}</td>
            <td style={{ textAlign: "right" }}>× {g.n}</td>
            <td className="mono small">e.g. {shorten(g.sample, BASE)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RichResult({ doc }: { doc: Record<string, unknown> }) {
  const agg = doc.aggregateRating as { ratingValue: number; ratingCount: number } | undefined;
  const directors = (doc.director as { name: string }[] | undefined)?.map((d) => d.name).join(", ");
  const cast = (doc.actor as { actor: { name: string }; characterName: string[] }[] | undefined) ?? [];
  const stars = agg ? Math.round(agg.ratingValue / 20) : 0;
  return (
    <div className="serp-card rich big">
      <div className="serp-url">movies.example.com › {String(doc.name).toLowerCase().replace(/\s+/g, "-")}</div>
      <div className="serp-title">
        {String(doc.name)} {doc.datePublished ? `(${doc.datePublished})` : ""}
      </div>
      {agg ? (
        <div className="serp-stars">
          {"★".repeat(stars)}
          {"☆".repeat(5 - stars)}{" "}
          <span>
            {agg.ratingValue}/100 · {agg.ratingCount} review{agg.ratingCount > 1 ? "s" : ""}
          </span>
        </div>
      ) : (
        <div className="serp-text muted">No reviews in the graph</div>
      )}
      {doc.description ? <div className="serp-text">“{String(doc.description)}”</div> : null}
      {directors && <div className="serp-text">Director: {directors}</div>}
      <div className="serp-cast">
        {cast.slice(0, 8).map((c) => (
          <span key={c.actor.name} className="serp-castmember">
            <strong>{c.actor.name}</strong>
            <span>{c.characterName.join(", ")}</span>
          </span>
        ))}
      </div>
      <div className="serp-foot">Preview rendered from the JSON-LD on the left only.</div>
    </div>
  );
}
