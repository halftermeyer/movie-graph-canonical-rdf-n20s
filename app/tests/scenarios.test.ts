// Every scenario's queries, machine-tested against the live database in .env.
// The suite bootstraps from whatever state the database is in: it resets first.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDriver } from "../src/lib/neo4j";
import { executeTool, resetAssistantCache } from "../src/lib/assistantTools";
import {
  BACON_SCOPE,
  BENCHMARK_SCOPES,
  SCOPES,
  applyBridge,
  captureInvariants,
  checkPrerequisites,
  clearDatabase,
  getGraphStats,
  loadMovies,
  compareBacon,
  cypherBaconNumbers,
  dropAllGraphs,
  explainBacon,
  exportSnapshot,
  fetchElements,
  listRecords,
  movieJsonLd,
  movieWikidata,
  oneSnapshotTwoConsumers,
  prepareProofGraph,
  proofElementIds,
  rdfBaconBounds,
  recordIri,
  resetDemo,
  runParityBenchmark,
  testOwlProfiles,
  validateSchemaOrg,
} from "../src/lib/queries";

beforeAll(async () => {
  const pre = await checkPrerequisites();
  expect(pre.reachable, pre.error).toBe(true);
  expect(pre.missing).toEqual([]);
  const stats = await resetDemo();
  expect(stats.movies).toBe(38);
  expect(stats.people).toBe(133);
});

afterAll(async () => {
  await dropAllGraphs();
  await closeDriver();
});

describe("Bootstrap", () => {
  it("starts from an empty database and loads the Movie Graph from the app", async () => {
    await clearDatabase();
    expect((await getGraphStats()).movies).toBe(0);
    const stats = await loadMovies();
    expect(stats.movies).toBe(38);
    expect(stats.relationships.reduce((s, r) => s + r.count, 0)).toBe(253);
  });
});

describe("Scenario 1: one snapshot, two consumers", () => {
  it("exports TriG and projects the same records", async () => {
    const r = await oneSnapshotTwoConsumers(SCOPES[0].cypher, "t_s1");
    expect(r.exported.trig).toContain("lpg:Snapshot");
    expect(r.exported.relationships).toBe(r.projected.relationships);
    expect(r.exported.nodes).toBe(r.projected.nodes);
    expect(r.records.filter((x) => x.kind === "Relationship").every((x) => x.labelOrType === "ACTED_IN")).toBe(true);
  });

  it("RETURN r brings both endpoints (closure rule)", async () => {
    const e = await exportSnapshot(SCOPES[0].cypher);
    expect(e.relationships).toBe(5); // The Matrix: 5 ACTED_IN
    expect(e.nodes).toBe(6); // 5 actors + the movie, none returned explicitly
  });

  it("RETURN n brings no relationships", async () => {
    const e = await exportSnapshot(SCOPES[1].cypher);
    expect(e.nodes).toBe(6);
    expect(e.relationships).toBe(0);
  });

  it("extra columns like length(p) are ignored", async () => {
    const withExtras = await exportSnapshot(SCOPES[2].cypher, "same");
    const plain = await exportSnapshot(
      `MATCH path = (:Person)-[:ACTED_IN]->(:Movie {title: 'The Matrix'}) RETURN path`,
      "same"
    );
    expect(withExtras.quads).toBe(plain.quads);
    expect(withExtras.relationships).toBe(5);
  });

  it("relationships are resources with lpg:source / lpg:target", async () => {
    const records = await listRecords("t_s1");
    const rel = records.find((x) => x.kind === "Relationship")!;
    expect(rel.source).toMatch(/\/e\/4:/);
    expect(rel.target).toMatch(/\/e\/4:/);
  });
});

describe("Parity benchmark", () => {
  for (const s of BENCHMARK_SCOPES) {
    it(`export and projection are isomorphic: ${s.label}`, async () => {
      const r = await runParityBenchmark(s.cypher, "t_bench");
      expect(r.diff).toBeUndefined();
      expect(r.isomorphic).toBe(true);
      expect(r.export.triples).toBe(r.project.triples);
    });
  }
});

describe("Scenario 2: the web speaks schema.org", () => {
  it("applies the bridge", async () => {
    const run = await applyBridge("schemaorg");
    expect(run.steps.length).toBeGreaterThan(4);
    const last = run.steps[run.steps.length - 1];
    expect(last.triplesAfter).toBeGreaterThan(run.snapshot.triplesAfter);
  });

  it("validates with SHACL: no violation, only warnings", async () => {
    const v = await validateSchemaOrg();
    const violations = v.filter((x) => x.severity.includes("Violation"));
    expect(violations, JSON.stringify(violations.slice(0, 3), null, 2)).toEqual([]);
  });

  it("outputs a JSON-LD block for a movie; the ACTED_IN record IS the PerformanceRole", async () => {
    const ld = await movieJsonLd("The Matrix");
    expect(ld["@type"]).toBe("Movie");
    expect(ld.datePublished).toBe("1999");
    const actors = ld.actor as { "@id": string; actor: { name: string }; characterName: string[] }[];
    const keanu = actors.find((a) => a.actor.name === "Keanu Reeves")!;
    expect(keanu.characterName).toEqual(["Neo"]);
    expect(keanu["@id"]).toMatch(/\/e\/5:/); // a relationship elementId
    expect((ld.director as { name: string }[]).map((d) => d.name).sort()).toEqual(["Lana Wachowski", "Lilly Wachowski"]);
  });

  it("aggregates ratings from reviews", async () => {
    const ld = await movieJsonLd("Cloud Atlas");
    const agg = ld.aggregateRating as { ratingValue: number; ratingCount: number };
    expect(agg.ratingCount).toBe(1);
    expect(agg.ratingValue).toBe(95);
  });
});

describe("Scenario 3: change the target, not the graph", () => {
  it("switching to Wikidata changes the output, not the graph nor the snapshot", async () => {
    const before = await captureInvariants();
    await applyBridge("wikidata");
    const triples = await movieWikidata("The Matrix");
    const preds = new Set(triples.map((t) => t.predicate));
    expect(preds.has("http://www.wikidata.org/prop/direct/P57")).toBe(true);
    expect(preds.has("http://www.wikidata.org/prop/direct/P161")).toBe(true);
    expect(preds.has("http://www.wikidata.org/prop/direct/P577")).toBe(true);
    expect([...preds].some((p) => p.startsWith("https://schema.org/"))).toBe(false);
    const after = await captureInvariants();
    expect(after).toEqual(before);
  });
});

describe("Scenario 4: six degrees, proven", () => {
  it("for every person in the Bacon scope, the RDF tightest bound equals Cypher's shortest path", async () => {
    const cypher = await cypherBaconNumbers();
    const rdf = await rdfBaconBounds("rules");
    const table = compareBacon(cypher, rdf.bounds);
    expect(table.length).toBeGreaterThan(100);
    const mismatches = table.filter((r) => r.rdf !== r.cypher);
    expect(mismatches).toEqual([]);
  });

  it("the OWL definition, under OWL_MICRO, gives the same bounds", async () => {
    const rules = await rdfBaconBounds("rules");
    const owl = await rdfBaconBounds("owl", "OWL_MICRO");
    expect(owl.bounds).toEqual(rules.bounds);
  });

  it("reports which profiles fire the OWL ladder", async () => {
    const r = await testOwlProfiles(["RDFS", "OWL_MICRO"], 15_000);
    expect(r.find((x) => x.profile === "RDFS")!.fired).toBe(false);
    expect(r.find((x) => x.profile === "OWL_MICRO")!.fired).toBe(true);
  });

  it("explain renders the proof as a path of ACTED_IN records, back to elementIds", async () => {
    await prepareProofGraph("t_proof");
    const cypher = await cypherBaconNumbers();
    const tom = cypher.find((c) => c.name === "Tom Hanks")!;
    const proof = await explainBacon(recordIri(tom.elementId), tom.baconNumber, "t_proof");
    expect(proof.hops.length).toBe(tom.baconNumber);
    expect(proof.hops[0].from).toBe(recordIri(tom.elementId));
    const bacon = cypher.find((c) => c.name === "Kevin Bacon")!;
    expect(proof.hops[proof.hops.length - 1].to).toBe(recordIri(bacon.elementId));
    const els = await fetchElements(proofElementIds(proof));
    expect(els.rels.every((r) => r.type === "ACTED_IN")).toBe(true);
    expect(els.rels.length).toBe(2 * tom.baconNumber);
  });

  it("Kevin Bacon is within 0; nobody in scope is beyond 4", async () => {
    const rdf = await rdfBaconBounds("rules");
    expect(rdf.bounds.find((b) => b.name === "Kevin Bacon")!.bound).toBe(0);
    expect(Math.max(...rdf.bounds.map((b) => b.bound))).toBeLessThanOrEqual(4);
    expect(BACON_SCOPE).toContain("shortestPath");
  });
});

describe("Assistant tools (what Gemini calls)", () => {
  beforeAll(() => resetAssistantCache());

  it("people_within(2) lists RDF-proven members with their tightest bound", async () => {
    const r = (await executeTool("people_within", { k: 2 })) as { count: number; rows: { name: string; tightestDerivedBound: number }[] };
    expect(r.count).toBe(1 + 19 + 53);
    expect(r.rows.every((x) => x.tightestDerivedBound <= 2)).toBe(true);
  });

  it("explain_within returns a chain of films through ACTED_IN records", async () => {
    const r = (await executeTool("explain_within", { name: "Keanu Reeves" })) as { hops: { from: string; movie: string; to: string; actedInRecords: string[] }[] };
    expect(r.hops.length).toBe(2);
    expect(r.hops[0].from).toBe("Keanu Reeves");
    expect(r.hops[1].to).toBe("Kevin Bacon");
    expect(r.hops.every((h) => h.actedInRecords.every((id) => id.startsWith("5:")))).toBe(true);
  });

  it("refuses to prove a bound tighter than what is derived", async () => {
    const r = (await executeTool("explain_within", { name: "Keanu Reeves", k: 1 })) as { error?: string };
    expect(r.error).toMatch(/cannot prove/);
  });

  it("bacon_numbers is Cypher, closed world", async () => {
    const r = (await executeTool("bacon_numbers", { names: ["Meg Ryan"] })) as { rows: { exactBaconNumber: number }[] };
    expect(r.rows[0].exactBaconNumber).toBe(2);
  });

  it("run_cypher refuses writes", async () => {
    const r = (await executeTool("run_cypher", { cypher: "MATCH (n) DETACH DELETE n" })) as { error?: string };
    expect(r.error).toBeDefined();
    expect((await getGraphStats()).movies).toBe(38);
  });

  it("export, project and JSON-LD tools answer", async () => {
    const e = (await executeTool("export_snapshot", { scope: SCOPES[0].cypher })) as { relationships: number };
    expect(e.relationships).toBe(5);
    const p = (await executeTool("project_snapshot", { scope: SCOPES[0].cypher })) as { triples: number };
    expect(p.triples).toBeGreaterThan(50);
    const ld = (await executeTool("movie_jsonld", { title: "Apollo 13" })) as { datePublished: string };
    expect(ld.datePublished).toBe("1995");
  });
});
