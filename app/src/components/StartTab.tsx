import { FilledButton, OutlinedButton } from "@neo4j-ndl/react";
import { clearDatabase, loadMovies, type GraphStats, type Prerequisites } from "../lib/queries";
import { DATABASE } from "../lib/neo4j";
import { ErrorBanner, useAction } from "./ui";

const SCENARIOS = [
  { id: "s1", n: 1, title: "One snapshot, two consumers", line: "The same Cypher scope feeds a TriG file and an in-memory reasoner." },
  { id: "s2", n: 2, title: "The web speaks schema.org", line: "A declarative bridge, SHACL-validated, gives a JSON-LD block a search engine reads." },
  { id: "s3", n: 3, title: "Change the target, not the graph", line: "Swap the bridge for Wikidata. Graph and snapshot do not move." },
  { id: "s4", n: 4, title: "Six degrees, proven", line: "RDF proves 'within 2'. Only Cypher knows 'exactly 2'." },
];

export default function StartTab({
  stats,
  pre,
  onChanged,
  onGo,
}: {
  stats: GraphStats | null;
  pre: Prerequisites;
  onChanged: () => Promise<void>;
  onGo: (tab: string) => void;
}) {
  const load = useAction(async () => {
    await loadMovies();
    await onChanged();
  });
  const clear = useAction(async () => {
    await clearDatabase();
    await onChanged();
  });
  const empty = !stats || stats.movies === 0;

  return (
    <div className="start">
      <div className="thesis">
        <div className="thesis-col">
          <div className="thesis-step">Scope</div>
          <div className="thesis-tool">Cypher</div>
          <p>Pick exactly the records that matter: a cast, a shortest path, a neighbourhood.</p>
        </div>
        <div className="thesis-arrow">→</div>
        <div className="thesis-col">
          <div className="thesis-step">Snapshot</div>
          <div className="thesis-tool">rdfsnapshot</div>
          <p>Serialize those records mechanically: no mapping, no templates. Records, not things.</p>
        </div>
        <div className="thesis-arrow">→</div>
        <div className="thesis-col">
          <div className="thesis-step">Reason</div>
          <div className="thesis-tool">n20s</div>
          <p>Bridge, infer, validate, explain, with plain RDF/SPARQL/rule files you can swap.</p>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Data</h3>
        {empty ? (
          <p>
            Database <code>{DATABASE}</code> is empty. The demo bootstraps from here: the button runs the{" "}
            <code>:play movies</code> script (<code>data/movies.cypher</code>) statement by statement.
          </p>
        ) : (
          <p>
            Database <code>{DATABASE}</code>: <strong>{stats.movies}</strong> movies, <strong>{stats.people}</strong> people,{" "}
            {stats.relationships.map((r) => `${r.count} ${r.type}`).join(", ")}.
            {stats.n20sGraphs.length > 0 && (
              <>
                {" "}In-memory n20s graphs: {stats.n20sGraphs.map((g) => `${g.graphName} (${g.tripleCount})`).join(", ")}.
              </>
            )}
          </p>
        )}
        <div className="button-group">
          {empty ? (
            <FilledButton onClick={() => load.run()} isLoading={load.running}>
              Load the Movie Graph
            </FilledButton>
          ) : (
            <OutlinedButton onClick={() => clear.run()} isLoading={clear.running}>
              Clear database (start from empty)
            </OutlinedButton>
          )}
        </div>
        <ErrorBanner error={load.error ?? clear.error} />
        <div className="env-line">
          Neo4j {pre.version} {pre.edition} · n20s {pre.n20sVersion ?? "?"} · rdfsnapshot.export ✓
        </div>
      </div>

      <div className="scenario-grid">
        {SCENARIOS.map((s) => (
          <button key={s.id} className="scenario-tile" onClick={() => onGo(s.id)} disabled={empty}>
            <span className="scenario-number">{s.n}</span>
            <span className="scenario-tile-title">{s.title}</span>
            <span className="scenario-tile-line">{s.line}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
