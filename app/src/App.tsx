import { useCallback, useEffect, useState } from "react";
import { Banner, FilledButton, LoadingSpinner, OutlinedButton, Tabs } from "@neo4j-ndl/react";
import { checkPrerequisites, getGraphStats, resetDemo, MIN_NEO4J, type GraphStats, type Prerequisites } from "./lib/queries";
import { DATABASE } from "./lib/neo4j";
import StartTab from "./components/StartTab";
import SnapshotTab from "./components/SnapshotTab";
import SchemaOrgTab from "./components/SchemaOrgTab";
import WikidataTab from "./components/WikidataTab";
import BaconTab from "./components/BaconTab";
import LayersTab from "./components/LayersTab";
import BenchmarkTab from "./components/BenchmarkTab";
import ChatTab from "./components/ChatTab";
import QueryAuditDrawer from "./components/QueryAuditDrawer";
import "./App.css";

export default function App() {
  const [pre, setPre] = useState<Prerequisites | null>(null);
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [tab, setTab] = useState("start");
  const [resetting, setResetting] = useState(false);
  const [epoch, setEpoch] = useState(0); // bumps on reset: scenario tabs remount clean

  const refresh = useCallback(async () => setStats(await getGraphStats()), []);

  useEffect(() => {
    checkPrerequisites().then(async (p) => {
      setPre(p);
      if (p.reachable && p.missing.length === 0) await refresh();
    });
  }, [refresh]);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      setStats(await resetDemo());
      setEpoch((e) => e + 1);
    } finally {
      setResetting(false);
    }
  }, []);

  const blocked = pre && (!pre.reachable || pre.missing.length > 0);
  const empty = stats && stats.movies === 0;

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-content">
          <div className="header-row">
            <div>
              <h1>
                <span className="header-icon">🎬</span> Movie Graph → RDF → n20s
              </h1>
              <p className="subtitle">Scope first (Cypher), reason second (n20s).</p>
            </div>
            <div className="header-status">
              {stats && (
                <span className="header-chip" title={`Database ${DATABASE}`}>
                  {stats.movies} movies · {stats.people} people · {stats.n20sGraphs.length} n20s graphs
                </span>
              )}
              {pre && !blocked && (
                <OutlinedButton size="small" onClick={reset} isLoading={resetting} isDisabled={resetting} className="header-reset">
                  Reset demo
                </OutlinedButton>
              )}
            </div>
          </div>
        </div>
      </header>

      {!pre && (
        <div className="loading-container">
          <LoadingSpinner size="large" /> Checking Neo4j and plugins…
        </div>
      )}

      {pre && blocked && <PrerequisiteBlock pre={pre} />}

      {pre && !blocked && (
        <>
          {!pre.versionOk && (
            <div className="version-warning">
              <Banner variant="warning" isCloseable={false}>
                Neo4j {pre.version} detected; rdfsnapshot 0.1.0 targets {MIN_NEO4J}+ Enterprise. The plugins answer, so the
                demo runs, but it is outside the supported range.
              </Banner>
            </div>
          )}
          <div className="app-tabs">
            <Tabs fill="underline" onChange={setTab} value={tab}>
              <Tabs.Tab id="start">Start</Tabs.Tab>
              <Tabs.Tab id="s1">1 · One snapshot</Tabs.Tab>
              <Tabs.Tab id="s2">2 · schema.org</Tabs.Tab>
              <Tabs.Tab id="s3">3 · Wikidata</Tabs.Tab>
              <Tabs.Tab id="s4">4 · Six degrees</Tabs.Tab>
              <Tabs.Tab id="layers">Layers</Tabs.Tab>
              <Tabs.Tab id="bench">Benchmark</Tabs.Tab>
              <Tabs.Tab id="chat">Assistant</Tabs.Tab>
            </Tabs>
          </div>
          <main className="app-main" key={epoch}>
            {tab === "start" && <StartTab stats={stats} pre={pre} onChanged={refresh} onGo={setTab} />}
            {tab !== "start" && tab !== "layers" && empty && (
              <Banner variant="info" isCloseable={false}>
                The database is empty. Load the Movie Graph from the Start tab first.
              </Banner>
            )}
            {!empty && (
              <>
                {tab === "s1" && <SnapshotTab />}
                {tab === "s2" && <SchemaOrgTab />}
                {tab === "s3" && <WikidataTab />}
                {tab === "s4" && <BaconTab />}
                {tab === "bench" && <BenchmarkTab />}
                {tab === "chat" && <ChatTab />}
              </>
            )}
            {tab === "layers" && <LayersTab />}
          </main>
          <QueryAuditDrawer />
        </>
      )}
    </div>
  );
}

function PrerequisiteBlock({ pre }: { pre: Prerequisites }) {
  return (
    <div className="blocking">
      <div className="blocking-card">
        <h2>The demo cannot start</h2>
        {!pre.reachable ? (
          <>
            <p>
              Neo4j is not reachable with the settings in <code>.env</code> (<code>NEO4J_URI</code>,{" "}
              <code>NEO4J_USER</code>, <code>NEO4J_PASSWORD</code>, <code>NEO4J_DATABASE</code>).
            </p>
            <pre className="blocking-error">{pre.error}</pre>
          </>
        ) : (
          <>
            <p>
              Neo4j {pre.version} {pre.edition} is reachable, but these procedures are missing. Install the plugins in{" "}
              <code>$NEO4J_HOME/plugins</code>, make sure <code>neo4j.conf</code> allows <code>rdfsnapshot.*</code> and{" "}
              <code>n20s.*</code> if you use a procedure allowlist, restart Neo4j and check again.
            </p>
            <ul className="blocking-list">
              {pre.missing.map((m) => (
                <li key={m}>
                  <code>{m}</code>
                </li>
              ))}
            </ul>
            <p>
              <strong>rdfsnapshot 0.1.0</strong>: github.com/halftermeyer/neo4j-rdf-snapshot ·{" "}
              <strong>n20s</strong> (with <code>projectSnapshot</code>): github.com/halftermeyer/neo4j-n20s
            </p>
          </>
        )}
        <FilledButton onClick={() => location.reload()}>Check again</FilledButton>
      </div>
    </div>
  );
}
