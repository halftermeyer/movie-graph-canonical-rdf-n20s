// Typed query functions. Every call to Neo4j goes through runQuery(), so every
// statement lands in the Cypher audit drawer, grouped per user action.
// Cypher scopes; rdfsnapshot serializes; n20s reasons. The LLM only calls these.

import moviesCypher from "../../../data/movies.cypher?raw";
import { runQuery, withGroup } from "./neo4j";
import { bridge, ONTOLOGY, RULES, SHAPES, type BridgeTarget, type LayerFile } from "./layers";
import {
  NS,
  parseTrig,
  triplesToQuads,
  withoutGeneratedAt,
  isIsomorphic,
  quadDiff,
  snapshotFingerprint,
  type TripleRow,
} from "./rdf";

export const BASE = "http://neo4j.example/movies";
export const RECORD = BASE + "/e/";
export const REQUIRED_PROCEDURES = [
  "rdfsnapshot.export",
  "n20s.graph.projectSnapshot",
  "n20s.graph.addTurtle",
  "n20s.graph.infer",
  "n20s.graph.inferWithRules",
  "n20s.graph.construct",
  "n20s.graph.query",
  "n20s.graph.validate",
  "n20s.graph.explain",
  "n20s.graph.triples",
  "n20s.graph.list",
  "n20s.graph.drop",
];
export const MIN_NEO4J = "2026.09";

export const recordIri = (elementId: string) => RECORD + elementId;
export const elementIdOf = (iri: string) => (iri.startsWith(RECORD) ? iri.slice(RECORD.length) : null);

const timed = async <T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t0) };
};

// ── Setup: prerequisites, data, reset ─────────────────────────

export interface Prerequisites {
  reachable: boolean;
  error?: string;
  version?: string;
  edition?: string;
  versionOk: boolean;
  missing: string[];
  n20sVersion?: string;
}

function versionAtLeast(v: string, min: string): boolean {
  const a = v.split(".").map((x) => parseInt(x, 10));
  const b = min.split(".").map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

export async function checkPrerequisites(): Promise<Prerequisites> {
  return withGroup("Startup check", async () => {
    try {
      const [comp] = await runQuery<{ version: string; edition: string }>(
        `CALL dbms.components() YIELD name, versions, edition
WHERE name = 'Neo4j Kernel'
RETURN versions[0] AS version, edition`
      );
      const procs = await runQuery<{ name: string }>(
        `SHOW PROCEDURES YIELD name
WHERE name STARTS WITH 'rdfsnapshot.' OR name STARTS WITH 'n20s.'
RETURN name`
      );
      const present = new Set(procs.map((p) => p.name));
      const missing = REQUIRED_PROCEDURES.filter((p) => !present.has(p));
      let n20sVersion: string | undefined;
      if (present.has("n20s.version")) {
        const [v] = await runQuery<{ version: string; jena: string }>(
          `CALL n20s.version() YIELD version, jenaVersion RETURN version, jenaVersion AS jena`
        );
        n20sVersion = `${v.version} (Jena ${v.jena})`;
      }
      return {
        reachable: true,
        version: comp.version,
        edition: comp.edition,
        versionOk: versionAtLeast(comp.version, MIN_NEO4J),
        missing,
        n20sVersion,
      };
    } catch (e) {
      return { reachable: false, error: (e as Error).message, versionOk: false, missing: REQUIRED_PROCEDURES };
    }
  });
}

export interface GraphStats {
  movies: number;
  people: number;
  relationships: { type: string; count: number }[];
  n20sGraphs: { graphName: string; tripleCount: number }[];
}

export async function getGraphStats(): Promise<GraphStats> {
  const [counts] = await runQuery<{ movies: number; people: number }>(
    `RETURN COUNT { (:Movie) } AS movies, COUNT { (:Person) } AS people`
  );
  const relationships = await runQuery<{ type: string; count: number }>(
    `MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS count ORDER BY count DESC`
  );
  const n20sGraphs = await runQuery<{ graphName: string; tripleCount: number }>(
    `CALL n20s.graph.list() YIELD graphName, tripleCount RETURN graphName, tripleCount ORDER BY graphName`
  );
  return { ...counts, relationships, n20sGraphs };
}

/** The `:play movies` script, split into statements (one per line ending with `;`). */
export function movieStatements(): string[] {
  return moviesCypher
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function loadMovies(): Promise<GraphStats> {
  return withGroup("Load the Movie Graph (:play movies)", async () => {
    for (const statement of movieStatements()) await runQuery(statement);
    return getGraphStats();
  });
}

export async function dropAllGraphs(): Promise<string[]> {
  const rows = await runQuery<{ graphName: string }>(
    `CALL n20s.graph.list() YIELD graphName
CALL n20s.graph.drop(graphName) YIELD status
RETURN graphName`
  );
  return rows.map((r) => r.graphName);
}

/** Reset: drop every n20s graph, clear the database, reload the Movie Graph. */
export async function resetDemo(): Promise<GraphStats> {
  return withGroup("Reset demo", async () => {
    await dropAllGraphs();
    await runQuery(`MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS`);
    for (const statement of movieStatements()) await runQuery(statement);
    return getGraphStats();
  });
}

export async function clearDatabase(): Promise<void> {
  await withGroup("Clear database", async () => {
    await dropAllGraphs();
    await runQuery(`MATCH (n) CALL (n) { DETACH DELETE n } IN TRANSACTIONS OF 1000 ROWS`);
  });
}

// ── Snapshot: export and projection ───────────────────────────

export interface ScopeExample {
  id: string;
  label: string;
  cypher: string;
  rule: string;
}

export const SCOPES: ScopeExample[] = [
  {
    id: "rels",
    label: "RETURN r",
    cypher: `MATCH (:Person)-[r:ACTED_IN]->(:Movie {title: 'The Matrix'})
RETURN r`,
    rule: "Closure rule: only relationships are returned, yet both endpoints come along.",
  },
  {
    id: "nodes",
    label: "RETURN n",
    cypher: `MATCH (p:Person)-[:ACTED_IN]->(m:Movie {title: 'The Matrix'})
RETURN p, m`,
    rule: "Only nodes are returned: no relationship is in scope, even though they exist in the graph.",
  },
  {
    id: "path",
    label: "RETURN path, length(path)",
    cypher: `MATCH path = (:Person)-[:ACTED_IN]->(:Movie {title: 'The Matrix'})
RETURN path, length(path) AS hops, 'ignored' AS note`,
    rule: "Paths are decomposed into their nodes and relationships; other columns (hops, note) are ignored.",
  },
];

export interface ExportResult {
  trig: string;
  ms: number;
  quads: number;
  nodes: number;
  relationships: number;
}

export async function exportSnapshot(scope: string, snapshotId?: string): Promise<ExportResult> {
  const config: Record<string, string> = { base: BASE };
  if (snapshotId) config.snapshotId = snapshotId;
  const { value: rows, ms } = await timed(() =>
    runQuery<{ chunk: string }>(
      `CALL rdfsnapshot.export($scope, $config) YIELD chunk
RETURN chunk`,
      { scope, config }
    )
  );
  const trig = rows.map((r) => r.chunk).join("");
  const quads = parseTrig(trig);
  const count = (cls: string) =>
    quads.filter((q) => q.predicate.value === NS.rdf + "type" && q.object.value === NS.lpg + cls).length;
  return { trig, ms, quads: quads.length, nodes: count("Node"), relationships: count("Relationship") };
}

export interface ProjectResult {
  graphName: string;
  snapshotId: string;
  snapshotIri: string;
  nodes: number;
  relationships: number;
  triplesAfter: number;
  ms: number;
}

export async function projectSnapshot(graphName: string, scope: string, snapshotId?: string): Promise<ProjectResult> {
  const config: Record<string, string> = { base: BASE, ifExists: "replace" };
  if (snapshotId) config.snapshotId = snapshotId;
  const { value: rows, ms } = await timed(() =>
    runQuery<Omit<ProjectResult, "ms">>(
      `CALL n20s.graph.projectSnapshot($graphName, $scope, $config)
YIELD graphName, snapshotId, snapshotIri, nodes, relationships, triplesAfter
RETURN graphName, snapshotId, snapshotIri, nodes, relationships, triplesAfter`,
      { graphName, scope, config }
    )
  );
  return { ...rows[0], ms };
}

export interface SnapshotRecord {
  iri: string;
  elementId: string;
  kind: "Node" | "Relationship";
  labelOrType: string;
  display: string;
  source?: string;
  target?: string;
}

/** The records of a projected snapshot, read back with SPARQL. */
export async function listRecords(graphName: string): Promise<SnapshotRecord[]> {
  const rows = await sparql<{
    r: string; eid: string; kind: string; lt: string; display?: string; source?: string; target?: string;
  }>(
    graphName,
    `PREFIX lpg: <${NS.lpg}>
SELECT ?r ?eid ?kind ?lt ?display ?source ?target WHERE {
  ?r lpg:elementId ?eid .
  { ?r a lpg:Node ; lpg:label/lpg:name ?lt . BIND("Node" AS ?kind)
    OPTIONAL { ?r <${BASE}/prop/title> ?t } OPTIONAL { ?r <${BASE}/prop/name> ?n }
    BIND(COALESCE(?t, ?n) AS ?display) }
  UNION
  { ?r a lpg:Relationship ; lpg:type/lpg:name ?lt ; lpg:source ?source ; lpg:target ?target .
    BIND("Relationship" AS ?kind) }
} ORDER BY ?kind ?lt ?display`
  );
  return rows.map((r) => ({
    iri: r.r,
    elementId: r.eid,
    kind: r.kind as SnapshotRecord["kind"],
    labelOrType: r.lt,
    display: r.display ?? "",
    source: r.source,
    target: r.target,
  }));
}

/** The triples of one record, for the record inspector. */
export async function recordTriples(graphName: string, iri: string): Promise<{ p: string; o: string }[]> {
  return sparql<{ p: string; o: string }>(
    graphName,
    `PREFIX rdf: <${NS.rdf}>
SELECT ?p ?o WHERE {
  { <${iri}> ?p ?o FILTER(!isBlank(?o)) }
  UNION
  { <${iri}> ?p ?list . ?list rdf:rest*/rdf:first ?item
    BIND(CONCAT("( list ) ∋ ", STR(?item)) AS ?o) }
} ORDER BY ?p`
  );
}

export async function sparql<T = Record<string, unknown>>(graphName: string, query: string, profile = ""): Promise<T[]> {
  const rows = await runQuery<{ row: T }>(
    `CALL n20s.graph.query($graphName, $query, $profile) YIELD row
RETURN row`,
    { graphName, query, profile }
  );
  return rows.map((r) => r.row);
}

export async function graphTriples(graphName: string): Promise<TripleRow[]> {
  return runQuery<TripleRow>(
    `CALL n20s.graph.triples($graphName) YIELD subject, predicate, object
RETURN subject, predicate, object`,
    { graphName }
  );
}

export async function dropGraph(graphName: string): Promise<void> {
  await runQuery(`CALL n20s.graph.drop($graphName) YIELD status RETURN status`, { graphName });
}

/** Scenario 1: one scope, two consumers. */
export async function oneSnapshotTwoConsumers(scope: string, graphName = "s1_snapshot") {
  return withGroup("One snapshot, two consumers", async () => {
    const exported = await exportSnapshot(scope);
    const projected = await projectSnapshot(graphName, scope);
    const records = await listRecords(graphName);
    return { exported, projected, records };
  });
}

// ── Parity benchmark ──────────────────────────────────────────

export interface BenchmarkResult {
  scope: string;
  snapshotId: string;
  export: { ms: number; triples: number; bytes: number };
  project: { ms: number; triples: number; readBackMs: number };
  isomorphic: boolean;
  compared: number;
  diff?: { onlyA: string[]; onlyB: string[] };
  checkMs: number;
}

export const BENCHMARK_SCOPES: ScopeExample[] = [
  { id: "all", label: "Whole graph", cypher: `MATCH (n) OPTIONAL MATCH (n)-[r]->() RETURN n, r`, rule: "Every node and relationship." },
  {
    id: "bacon",
    label: "Bacon scope",
    cypher: "",
    rule: "The scenario 4 scope: shortest ACTED_IN paths from Kevin Bacon.",
  },
  { id: "matrix", label: "The Matrix cast", cypher: SCOPES[0].cypher, rule: SCOPES[0].rule },
];

/** Export and projection of the same scope, timed, then checked for isomorphism. */
export async function runParityBenchmark(scope: string, graphName = "bench_parity"): Promise<BenchmarkResult> {
  return withGroup("Parity benchmark: export vs projection", async () => {
    const snapshotId = "bench-" + Date.now();
    const exported = await exportSnapshot(scope, snapshotId);
    const projected = await projectSnapshot(graphName, scope, snapshotId);
    const { value: rows, ms: readBackMs } = await timed(() => graphTriples(graphName));
    const t0 = performance.now();
    const a = withoutGeneratedAt(parseTrig(exported.trig));
    const b = withoutGeneratedAt(triplesToQuads(rows));
    const iso = a.length === b.length && isIsomorphic(a, b);
    const checkMs = Math.round(performance.now() - t0);
    await dropGraph(graphName);
    return {
      scope,
      snapshotId,
      export: { ms: exported.ms, triples: exported.quads, bytes: new TextEncoder().encode(exported.trig).length },
      project: { ms: projected.ms, triples: projected.triplesAfter, readBackMs },
      isomorphic: iso,
      compared: a.length,
      diff: iso ? undefined : quadDiff(a, b),
      checkMs,
    };
  });
}

// ── Bridges: schema.org and Wikidata ──────────────────────────

export const BRIDGE_SCOPE = `MATCH (m:Movie)
OPTIONAL MATCH (m)-[r]-(:Person)
RETURN m, r`;

export interface PipelineStep {
  step: string;
  detail: string;
  triplesAfter: number;
  ms: number;
}

async function addTurtles(graphName: string, files: LayerFile[]): Promise<number> {
  const [row] = await runQuery<{ triplesAfter: number }>(
    `UNWIND $turtles AS turtle
WITH n20s.graph.addTurtle($graphName, turtle) AS g
RETURN g.triplesAfter AS triplesAfter`,
    { graphName, turtles: files.map((f) => f.content) }
  );
  return row.triplesAfter;
}

/**
 * Run a SPARQL CONSTRUCT and add its triples back into the graph.
 * n20s.graph.construct returns Jena's short forms ("v"^^xsd:T, bare strings);
 * the CASE puts them back into the (s, p, o) convention of n20s.graph.project.
 */
async function materializeConstruct(graphName: string, query: string): Promise<number> {
  const rows = await runQuery<{ triplesAfter: number | null }>(
    `CALL n20s.graph.construct($graphName, $query) YIELD subject, predicate, object
WITH subject, predicate,
     CASE
       WHEN object CONTAINS '"^^xsd:'
         THEN replace(object, '"^^xsd:', '"^^<http://www.w3.org/2001/XMLSchema#') + '>'
       WHEN object STARTS WITH '"' OR object STARTS WITH '_:' OR object =~ '^[a-z]+:.*' AND NOT object CONTAINS ' '
         THEN object
       ELSE '"' + object + '"'
     END AS object
WITH collect([subject, predicate, object]) AS triples
UNWIND triples AS t
WITH n20s.graph.project($graphName, t[0], t[1], t[2], 'append') AS g
RETURN g.triplesAfter AS triplesAfter`,
    { graphName, query }
  );
  return rows[0]?.triplesAfter ?? (await tripleCount(graphName));
}

async function tripleCount(graphName: string): Promise<number> {
  const rows = await runQuery<{ tripleCount: number }>(
    `CALL n20s.graph.list() YIELD graphName, tripleCount
WHERE graphName = $graphName
RETURN tripleCount`,
    { graphName }
  );
  return rows[0]?.tripleCount ?? 0;
}

async function inferWithRules(graphName: string, rules: string, profile = ""): Promise<number> {
  const [row] = await runQuery<{ triplesAfter: number }>(
    `CALL n20s.graph.inferWithRules($graphName, $rules, $profile)
YIELD triplesAfter
RETURN triplesAfter`,
    { graphName, rules, profile }
  );
  return row.triplesAfter;
}

export interface BridgeRun {
  target: BridgeTarget;
  graphName: string;
  snapshot: ProjectResult;
  steps: PipelineStep[];
}

/**
 * Apply a bridge to a fresh snapshot: project, load ontology + axioms,
 * materialize the CONSTRUCTs, then forward-chain the rules over RDFS.
 * For schema.org, the domain rules (auteur, aggregate rating) follow.
 */
export async function applyBridge(
  target: BridgeTarget,
  options: { scope?: string; skip?: string[] } = {}
): Promise<BridgeRun> {
  const { scope = BRIDGE_SCOPE, skip = [] } = options;
  const b = bridge(target);
  const graphName = `bridge_${target}`;
  return withGroup(`Bridge to ${b.label}`, async () => {
    const steps: PipelineStep[] = [];
    const step = async (name: string, detail: string, fn: () => Promise<number>) => {
      const { value, ms } = await timed(fn);
      steps.push({ step: name, detail, triplesAfter: value, ms });
    };
    const snapshot = await projectSnapshot(graphName, scope);
    steps.push({ step: "Snapshot", detail: "n20s.graph.projectSnapshot", triplesAfter: snapshot.triplesAfter, ms: snapshot.ms });
    await step("Ontology + axioms", [...ONTOLOGY, b.axioms].map((f) => f.path).join(", "), () =>
      addTurtles(graphName, [...ONTOLOGY, b.axioms])
    );
    for (const c of b.constructs) {
      if (skip.includes(c.path)) {
        steps.push({ step: "CONSTRUCT (skipped)", detail: c.path, triplesAfter: steps[steps.length - 1].triplesAfter, ms: 0 });
        continue;
      }
      await step("CONSTRUCT", c.path, () => materializeConstruct(graphName, c.content));
    }
    await step("Rules over RDFS", b.rules.path + " (profile RDFS)", () => inferWithRules(graphName, b.rules.content, "RDFS"));
    if (target === "schemaorg") {
      await step("Domain rule", RULES.aggregateRating.path, () => materializeConstruct(graphName, RULES.aggregateRating.content));
      await step("Domain rule", RULES.auteur.path, () => inferWithRules(graphName, RULES.auteur.content, "RDFS"));
    }
    return { target, graphName, snapshot, steps };
  });
}

export interface Violation {
  focusNode: string | null;
  path: string | null;
  severity: string;
  message: string;
  value: string | null;
}

/** SHACL: load the shapes next to the data, validate. A null focusNode means "conforms". */
export async function validateSchemaOrg(graphName = "bridge_schemaorg"): Promise<Violation[]> {
  return withGroup("SHACL validation (rules/shapes.ttl)", async () => {
    await addTurtles(graphName, [SHAPES]);
    return runQuery<Violation>(
      `CALL n20s.graph.validate($graphName)
YIELD focusNode, path, severity, message, value
RETURN focusNode, path, severity, message, value`,
      { graphName }
    );
  });
}

export async function listMovieTitles(): Promise<string[]> {
  const rows = await runQuery<{ title: string }>(`MATCH (m:Movie) RETURN m.title AS title ORDER BY title`);
  return rows.map((r) => r.title);
}

type Row = Record<string, string | number | null>;

const S = (q: string) => `PREFIX schema: <${NS.schema}>
PREFIX rdf: <${NS.rdf}>
PREFIX ex: <${NS.ex}>
${q}`;

/**
 * A ready-to-embed schema.org JSON-LD block for one movie, assembled from
 * SPARQL answers on the bridged graph: nothing is read from Neo4j directly.
 */
export async function movieJsonLd(title: string, graphName = "bridge_schemaorg"): Promise<Record<string, unknown>> {
  return withGroup(`schema.org JSON-LD: ${title}`, async () => {
    const t = JSON.stringify(title);
    const [movie] = await sparql<Row>(
      graphName,
      S(`SELECT ?m ?name ?published ?description ?avg ?count WHERE {
  ?m a schema:Movie ; schema:name ${t} .
  BIND(${t} AS ?name)
  OPTIONAL { ?m schema:datePublished ?published }
  OPTIONAL { ?m schema:description ?description }
  OPTIONAL { ?m schema:aggregateRating ?agg . ?agg schema:ratingValue ?avg ; schema:ratingCount ?count }
} LIMIT 1`)
    );
    if (!movie) throw new Error(`No schema:Movie named ${title} in ${graphName}. Apply the bridge first.`);
    const m = movie.m as string;
    const people = await sparql<Row>(
      graphName,
      S(`SELECT ?rel ?name ?birth WHERE {
  VALUES ?rel { schema:director schema:author schema:producer }
  <${m}> ?rel ?p . ?p schema:name ?name .
  OPTIONAL { ?p schema:birthDate ?birth }
} ORDER BY ?rel ?name`)
    );
    const roles = await sparql<Row>(
      graphName,
      S(`SELECT ?role ?name ?birth (GROUP_CONCAT(?character; separator="|") AS ?characters) WHERE {
  <${m}> schema:actor ?role .
  ?role a schema:PerformanceRole ; schema:actor ?p .
  ?p schema:name ?name .
  OPTIONAL { ?p schema:birthDate ?birth }
  OPTIONAL { ?role schema:characterName ?character }
} GROUP BY ?role ?name ?birth ORDER BY ?name`)
    );
    const reviews = await sparql<Row>(
      graphName,
      S(`SELECT ?review ?author ?body ?value WHERE {
  ?review a schema:Review ; schema:itemReviewed <${m}> ; schema:author/schema:name ?author .
  OPTIONAL { ?review schema:reviewBody ?body }
  OPTIONAL { ?review schema:reviewRating/schema:ratingValue ?value }
} ORDER BY ?author`)
    );
    const person = (r: Row) => ({
      "@type": "Person",
      name: r.name,
      ...(r.birth != null ? { birthDate: String(r.birth) } : {}),
    });
    const by = (rel: string) => people.filter((p) => p.rel === NS.schema + rel).map(person);
    const ld: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Movie",
      "@id": m,
      name: movie.name,
    };
    if (movie.published != null) ld.datePublished = String(movie.published);
    if (movie.description != null) ld.description = movie.description;
    for (const rel of ["director", "author", "producer"]) {
      const list = by(rel);
      if (list.length) ld[rel] = list;
    }
    if (roles.length) {
      ld.actor = roles.map((r) => ({
        "@type": "PerformanceRole",
        "@id": r.role,
        actor: person(r),
        characterName: String(r.characters ?? "").split("|").filter(Boolean),
      }));
    }
    if (movie.avg != null) {
      ld.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: Math.round(Number(movie.avg) * 10) / 10,
        ratingCount: movie.count,
        bestRating: 100,
        worstRating: 0,
      };
    }
    if (reviews.length) {
      ld.review = reviews.map((r) => ({
        "@type": "Review",
        "@id": r.review,
        author: { "@type": "Person", name: r.author },
        ...(r.body != null ? { reviewBody: r.body } : {}),
        ...(r.value != null
          ? { reviewRating: { "@type": "Rating", ratingValue: r.value, bestRating: 100, worstRating: 0 } }
          : {}),
      }));
    }
    return ld;
  });
}

/** The Wikidata-shaped triples about one movie (and its P161 statement nodes). */
export async function movieWikidata(title: string, graphName = "bridge_wikidata"): Promise<TripleRow[]> {
  return withGroup(`Wikidata view: ${title}`, async () =>
    runQuery<TripleRow>(
      `CALL n20s.graph.construct($graphName, $query) YIELD subject, predicate, object
RETURN subject, predicate, object`,
      {
        graphName,
        query: `PREFIX rdfs: <${NS.rdfs}>
PREFIX wdt: <${NS.wdt}>
PREFIX wp: <${NS.wp}>
CONSTRUCT { ?m ?p ?o . ?s ?sp ?so . ?o rdfs:label ?ol . ?so rdfs:label ?sol }
WHERE {
  ?m wdt:P31 ?film ; wdt:P1476 ${JSON.stringify(title)} .
  {
    ?m ?p ?o
    FILTER(STRSTARTS(STR(?p), "http://www.wikidata.org/") || ?p = rdfs:label)
    OPTIONAL { ?o rdfs:label ?ol }
  } UNION {
    ?m wp:P161 ?s . ?s ?sp ?so
    FILTER(STRSTARTS(STR(?sp), "http://www.wikidata.org/"))
    OPTIONAL { ?so rdfs:label ?sol }
  }
}`,
      }
    )
  );
}

/** What the bridged graph says about one IRI, next to what the snapshot said. */
export async function describeIri(graphName: string, iri: string): Promise<{ p: string; o: string }[]> {
  return sparql<{ p: string; o: string }>(
    graphName,
    `SELECT DISTINCT ?p ?o WHERE {
  <${iri}> ?p ?o
  FILTER(isIRI(?o) || isLiteral(?o))
  FILTER(STRSTARTS(STR(?p), "${NS.schema}") || STRSTARTS(STR(?p), "${NS.lpg}") || STRSTARTS(STR(?p), "${BASE}/prop/") || STRSTARTS(STR(?p), "http://www.wikidata.org/")
         || (?p = <${NS.rdf}type> && (STRSTARTS(STR(?o), "${NS.schema}") || STRSTARTS(STR(?o), "${NS.lpg}") || STRSTARTS(STR(?o), "${BASE}/"))))
} ORDER BY ?p ?o`
  );
}

/** Scenario 3 evidence: the database and the snapshot do not change when the bridge does. */
export interface Invariants {
  nodes: number;
  relationships: number;
  snapshotTriples: number;
  fingerprint: string;
}

export async function captureInvariants(scope = BRIDGE_SCOPE): Promise<Invariants> {
  return withGroup("Invariants: graph and snapshot", async () => {
    const [c] = await runQuery<{ nodes: number; relationships: number }>(
      `RETURN COUNT { () } AS nodes, COUNT { ()-->() } AS relationships`
    );
    const exported = await exportSnapshot(scope, "invariant");
    const quads = withoutGeneratedAt(parseTrig(exported.trig));
    return { ...c, snapshotTriples: quads.length, fingerprint: await snapshotFingerprint(quads) };
  });
}

// ── Six degrees: Cypher distances, RDF bounds, proofs ─────────

export const BACON = "Kevin Bacon";

/** The Movie Graph guide's Bacon query, as a scope: one shortest ACTED_IN path per person, up to 4 co-star hops. */
export const BACON_SCOPE = `MATCH (bacon:Person {name: 'Kevin Bacon'}), (p:Person)
WHERE p <> bacon
MATCH path = shortestPath((bacon)-[:ACTED_IN*..8]-(p))
RETURN path, length(path) / 2 AS baconNumber`;
BENCHMARK_SCOPES[1].cypher = BACON_SCOPE;

export interface CypherBacon {
  name: string;
  elementId: string;
  baconNumber: number;
}

/** Closed world: Cypher's exact Bacon number, a shortest path over the whole graph. */
export async function cypherBaconNumbers(): Promise<CypherBacon[]> {
  return runQuery<CypherBacon>(
    `MATCH (bacon:Person {name: 'Kevin Bacon'})
CALL (bacon) {
  RETURN bacon.name AS name, elementId(bacon) AS elementId, 0 AS baconNumber
  UNION
  MATCH (p:Person) WHERE p <> bacon
  MATCH path = shortestPath((bacon)-[:ACTED_IN*..8]-(p))
  RETURN p.name AS name, elementId(p) AS elementId, length(path) / 2 AS baconNumber
}
RETURN name, elementId, baconNumber
ORDER BY baconNumber, name`
  );
}

export const LADDER_RULES = () => RULES.coStar.content + "\n" + RULES.baconRules.content;

export interface RdfBound {
  iri: string;
  name: string;
  bound: number;
}

const BOUNDS_QUERY = `PREFIX p: <${BASE}/prop/>
PREFIX xsd: <${NS.xsd}>
SELECT ?x ?name (MIN(?k) AS ?bound) WHERE {
  ?x a ?rung ; p:name ?name .
  FILTER(STRSTARTS(STR(?rung), "${NS.ex}BaconWithin"))
  BIND(xsd:integer(STRAFTER(STR(?rung), "BaconWithin")) AS ?k)
} GROUP BY ?x ?name ORDER BY ?bound ?name`;

export interface LadderRun {
  scope: ProjectResult;
  method: "rules" | "owl";
  profile?: string;
  newTriples: number;
  ms: number;
  bounds: RdfBound[];
}

/**
 * Open world: RDF derives ex:coStar from ACTED_IN records, then the ladder.
 * method "rules": costar.rules + bacon-ladder.rules (one rule per rung).
 * method "owl": coStar materialized first, then the OWL definitions
 * (bacon-ladder.owl.ttl) under a reasoner profile.
 * The tightest bound is read afterwards: min k such that x is BaconWithin_k.
 */
export async function rdfBaconBounds(method: "rules" | "owl" = "rules", profile = "OWL_MICRO"): Promise<LadderRun> {
  const graphName = method === "rules" ? "bacon_rules" : `bacon_${profile.toLowerCase()}`;
  return withGroup(`Bacon ladder (${method === "rules" ? "Jena rules" : "OWL, " + profile})`, async () => {
    const scope = await projectSnapshot(graphName, BACON_SCOPE);
    const before = await addTurtles(graphName, [layerOntologyExt()]);
    const t0 = performance.now();
    let after: number;
    if (method === "rules") {
      after = await inferWithRules(graphName, LADDER_RULES());
    } else {
      await inferWithRules(graphName, RULES.coStar.content);
      await addTurtles(graphName, [RULES.baconOwl]);
      const [row] = await runQuery<{ triplesAfter: number }>(
        `CALL n20s.graph.infer($graphName, $profile) YIELD triplesAfter RETURN triplesAfter`,
        { graphName, profile }
      );
      after = row.triplesAfter;
    }
    const ms = Math.round(performance.now() - t0);
    const rows = await sparql<{ x: string; name: string; bound: number }>(graphName, BOUNDS_QUERY);
    return {
      scope,
      method,
      profile: method === "owl" ? profile : undefined,
      newTriples: after - before,
      ms,
      bounds: rows.map((r) => ({ iri: r.x, name: r.name, bound: Number(r.bound) })),
    };
  });
}

function layerOntologyExt(): LayerFile {
  return ONTOLOGY.find((f) => f.name === "movie-ext.ttl")!;
}

export interface ProfileTest {
  profile: string;
  fired: boolean;
  members: number;
  ms: number;
  status: "fired" | "silent" | "timeout" | "error";
  error?: string;
}

/** Which reasoner profile fires the OWL someValuesFrom axioms? Run live, with a time limit. */
export async function testOwlProfiles(
  profiles = ["RDFS", "OWL_MICRO", "OWL_MINI", "OWL"],
  timeoutMs = 15_000
): Promise<ProfileTest[]> {
  return withGroup("Which profile fires the OWL ladder?", async () => {
    const results: ProfileTest[] = [];
    for (const profile of profiles) {
      const graphName = `owltest_${profile.toLowerCase()}`;
      await projectSnapshot(graphName, BACON_SCOPE);
      await inferWithRules(graphName, RULES.coStar.content);
      await addTurtles(graphName, [layerOntologyExt(), RULES.baconOwl]);
      const t0 = performance.now();
      // Jena's rule engine does not watch the transaction: a timed-out infer
      // keeps computing. Dropping the graph closes its model and stops it.
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        dropGraph(graphName).catch(() => {});
      }, timeoutMs);
      try {
        await runQuery(
          `CALL n20s.graph.infer($graphName, $profile) YIELD newTriples RETURN newTriples`,
          { graphName, profile },
          { timeoutMs: timeoutMs + 5_000 }
        );
        clearTimeout(timer);
        const [row] = await sparql<{ n: number }>(
          graphName,
          `SELECT (COUNT(DISTINCT ?x) AS ?n) WHERE { ?x a <${NS.ex}BaconWithin1> . FILTER NOT EXISTS { ?x a <${NS.ex}BaconWithin0> } }`
        );
        const members = Number(row?.n ?? 0);
        results.push({
          profile,
          fired: members > 0,
          members,
          ms: Math.round(performance.now() - t0),
          status: members > 0 ? "fired" : "silent",
        });
      } catch (e) {
        clearTimeout(timer);
        const msg = (e as Error).message;
        const timeout = timedOut || /timeout|terminated|closed/i.test(msg);
        results.push({
          profile,
          fired: false,
          members: 0,
          ms: Math.round(performance.now() - t0),
          status: timeout ? "timeout" : "error",
          error: timeout ? `no answer within ${timeoutMs / 1000} s: stopped (graph dropped)` : msg,
        });
      }
      await dropGraph(graphName).catch(() => {});
    }
    return results;
  });
}

export interface ProofStep {
  step: number;
  depth: number;
  subject: string;
  predicate: string;
  object: string;
  kind: "derived" | "asserted" | "axiom";
  rule: string | null;
}

export interface ProofHop {
  from: string; // person record IRI
  to: string; // person record IRI
  movie: string; // movie record IRI
  via: [string, string]; // the two ACTED_IN record IRIs
}

export interface Proof {
  person: string;
  rung: number;
  steps: ProofStep[];
  hops: ProofHop[];
}

/** Base graph for proofs: the Bacon snapshot + movie-ext, nothing materialized. */
export async function prepareProofGraph(graphName = "bacon_proof"): Promise<ProjectResult> {
  return withGroup("Prepare the proof graph", async () => {
    const r = await projectSnapshot(graphName, BACON_SCOPE);
    await addTurtles(graphName, [layerOntologyExt()]);
    return r;
  });
}

/** n20s.graph.explain: the derivation of "person is BaconWithin_k", read back as a path. */
export async function explainBacon(personIri: string, rung: number, graphName = "bacon_proof"): Promise<Proof> {
  return withGroup(`Explain: within ${rung} of Kevin Bacon`, async () => {
    const steps = await runQuery<ProofStep>(
      `CALL n20s.graph.explain($graphName, $s, $p, $o, $rules, '')
YIELD step, depth, subject, predicate, object, kind, rule
RETURN step, depth, subject, predicate, object, kind, rule
ORDER BY step`,
      { graphName, s: personIri, p: NS.rdf + "type", o: `${NS.ex}BaconWithin${rung}`, rules: LADDER_RULES() }
    );
    return { person: personIri, rung, steps, hops: proofHops(steps) };
  });
}

/** Read the co-star hops out of the explain trace: each coStar step and its two ACTED_IN records. */
export function proofHops(steps: ProofStep[]): ProofHop[] {
  const hops: ProofHop[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== "derived" || s.predicate !== NS.ex + "coStar") return;
    const children: ProofStep[] = [];
    for (let j = i + 1; j < steps.length && steps[j].depth > s.depth; j++) {
      if (steps[j].depth === s.depth + 1) children.push(steps[j]);
    }
    const fact = (rec: string, pred: string) =>
      children.find((c) => c.subject === rec && c.predicate === NS.lpg + pred)?.object;
    const recs = [...new Set(children.filter((c) => c.predicate === NS.lpg + "type").map((c) => c.subject))];
    const r1 = recs.find((r) => fact(r, "source") === s.subject) ?? recs[0];
    const r2 = recs.find((r) => r !== r1 && fact(r, "source") === s.object) ?? recs[1];
    hops.push({ from: s.subject, to: s.object, movie: fact(r1, "target") ?? "", via: [r1, r2] });
  });
  return hops;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: "Person" | "Movie";
  detail?: string;
}

export interface GraphRel {
  id: string;
  source: string;
  target: string;
  type: string;
  detail?: string;
}

/** Back to Neo4j by elementId: the records a proof (or a selection) mentions. */
export async function fetchElements(elementIds: string[]): Promise<{ nodes: GraphNode[]; rels: GraphRel[] }> {
  const rows = await runQuery<{ nodes: GraphNode[]; rels: GraphRel[] }>(
    `MATCH (n) WHERE elementId(n) IN $ids
WITH collect({
  id: elementId(n),
  label: coalesce(n.title, n.name),
  kind: labels(n)[0],
  detail: toString(coalesce(n.released, n.born, ''))
}) AS nodes
OPTIONAL MATCH ()-[r]->() WHERE elementId(r) IN $ids
RETURN nodes, collect({
  id: elementId(r),
  source: elementId(startNode(r)),
  target: elementId(endNode(r)),
  type: type(r),
  detail: reduce(s = '', x IN coalesce(r.roles, []) | s + CASE s WHEN '' THEN '' ELSE ', ' END + x)
}) AS rels`,
    { ids: elementIds }
  );
  return rows[0] ?? { nodes: [], rels: [] };
}

export function proofElementIds(proof: Proof): string[] {
  const iris = proof.hops.flatMap((h) => [h.from, h.to, h.movie, ...h.via]);
  return [...new Set(iris.map(elementIdOf).filter((x): x is string => !!x))];
}

/** Side-by-side table: Cypher's exact number and RDF's tightest bound, per person. */
export interface BaconComparison {
  name: string;
  elementId: string;
  cypher: number;
  rdf: number | null;
}

export function compareBacon(cypher: CypherBacon[], rdf: RdfBound[]): BaconComparison[] {
  const byName = new Map(rdf.map((r) => [r.name, r.bound]));
  return cypher.map((c) => ({ name: c.name, elementId: c.elementId, cypher: c.baconNumber, rdf: byName.get(c.name) ?? null }));
}
