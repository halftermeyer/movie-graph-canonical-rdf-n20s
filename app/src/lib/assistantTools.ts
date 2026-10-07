// The Assistant's tools: thin wrappers over the typed query functions.
// The LLM picks tools and phrases the answer; every fact comes from here.

import { Type, type FunctionDeclaration } from "@google/genai";
import { runQuery, withGroup } from "./neo4j";
import {
  applyBridge,
  compareBacon,
  cypherBaconNumbers,
  elementIdOf,
  explainBacon,
  exportSnapshot,
  movieJsonLd,
  prepareProofGraph,
  projectSnapshot,
  rdfBaconBounds,
  testOwlProfiles,
  fetchElements,
  proofElementIds,
  type RdfBound,
} from "./queries";

export const GEMINI_MODEL = "gemini-3.8-flash";

export const SYSTEM_PROMPT = `You are the assistant of a Neo4j demo: the Movie Graph (Neo4j's ':play movies'
dataset: 38 movies, 133 people; relationships ACTED_IN {roles}, DIRECTED, WROTE, PRODUCED, REVIEWED {summary, rating},
FOLLOWS), snapshotted to RDF with rdfsnapshot.export, bridged to schema.org or Wikidata, reasoned over with n20s
(Apache Jena inside Neo4j).

Ground rules, never break them:
- Every fact in your answer comes from a tool result in this conversation. Never use your own knowledge of movies.
- Two different questions, two different tools:
  * "within k of Kevin Bacon" is an RDF entailment (open world). Use people_within, and explain_within for the "why".
  * "exactly k" / "Bacon number" is a Cypher shortest path (closed world). Use bacon_numbers.
  Never say RDF computed a Bacon number or a distance. RDF proves bounds ("within 2"); only Cypher knows "exactly 2".
- When asked "why", call explain_within and give the chain of films and co-stars it returns, citing the ACTED_IN
  record elementIds briefly.
- run_cypher is read-only; use it for anything else about the graph.
Write plain Markdown: no LaTeX, use the characters → ≤ ≥. Be concise. Use bullet lists or small tables. The UI shows the Cypher audit trail separately: don't repeat it.`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: "run_cypher",
    description:
      "Run a read-only Cypher query on the Movie Graph. Labels: Movie {title, released, tagline}, Person {name, born}. Relationships: (Person)-[:ACTED_IN {roles}]->(Movie), DIRECTED, WROTE, PRODUCED, (Person)-[:REVIEWED {summary, rating}]->(Movie), (Person)-[:FOLLOWS]->(Person).",
    parameters: {
      type: Type.OBJECT,
      properties: { cypher: { type: Type.STRING, description: "A read-only Cypher query" } },
      required: ["cypher"],
    },
  },
  {
    name: "bacon_numbers",
    description:
      "Closed world: exact Bacon numbers from Cypher shortestPath over ACTED_IN (co-star hops). Optionally filter by names.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        names: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Person names (optional)" },
        max: { type: Type.INTEGER, description: "Only people with a Bacon number <= max (optional)" },
      },
    },
  },
  {
    name: "people_within",
    description:
      "Open world: project the Bacon scope snapshot into n20s, derive ex:coStar and the BaconWithin ladder with rules, and list the people the reasoner proves to be within k co-star hops of Kevin Bacon, with their tightest derived bound.",
    parameters: {
      type: Type.OBJECT,
      properties: { k: { type: Type.INTEGER, description: "The rung, 0..6" } },
      required: ["k"],
    },
  },
  {
    name: "explain_within",
    description:
      "n20s.graph.explain: the derivation proving that a person is within k of Kevin Bacon, as a chain of co-star hops, each through two ACTED_IN records (with elementIds) and a movie. k defaults to the person's tightest bound.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Person name" },
        k: { type: Type.INTEGER, description: "Rung to prove (optional)" },
      },
      required: ["name"],
    },
  },
  {
    name: "export_snapshot",
    description: "rdfsnapshot.export: serialize the records returned by a Cypher scope query as TriG. Returns counts and the beginning of the document.",
    parameters: {
      type: Type.OBJECT,
      properties: { scope: { type: Type.STRING, description: "Cypher scope query" } },
      required: ["scope"],
    },
  },
  {
    name: "project_snapshot",
    description: "n20s.graph.projectSnapshot: load the snapshot of a Cypher scope into an in-memory RDF graph (graph 'assistant'). Returns counts.",
    parameters: {
      type: Type.OBJECT,
      properties: { scope: { type: Type.STRING, description: "Cypher scope query" } },
      required: ["scope"],
    },
  },
  {
    name: "movie_jsonld",
    description: "Apply the schema.org bridge (if needed) and return the schema.org JSON-LD block of a movie, built from SPARQL on the bridged graph.",
    parameters: {
      type: Type.OBJECT,
      properties: { title: { type: Type.STRING, description: "Exact movie title" } },
      required: ["title"],
    },
  },
  {
    name: "owl_profiles",
    description: "Test live which n20s reasoning profile fires the OWL someValuesFrom definition of the Bacon ladder.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
];

const WRITE = /\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|CALL\s+\{|FOREACH)\b/i;

let boundsCache: RdfBound[] | null = null;
let bridged = false;

async function bounds(): Promise<RdfBound[]> {
  if (!boundsCache) boundsCache = (await rdfBaconBounds("rules")).bounds;
  return boundsCache;
}

export function resetAssistantCache() {
  boundsCache = null;
  bridged = false;
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return withGroup(`Assistant · ${name}`, async () => {
    switch (name) {
      case "run_cypher": {
        const cypher = String(args.cypher ?? "");
        if (WRITE.test(cypher)) return { error: "Only read-only Cypher is allowed here." };
        const rows = await runQuery(cypher);
        return { rows: rows.slice(0, 50), total: rows.length };
      }
      case "bacon_numbers": {
        const all = await cypherBaconNumbers();
        const names = (args.names as string[] | undefined)?.map((n) => n.toLowerCase());
        const max = args.max as number | undefined;
        const rows = all
          .filter((r) => !names || names.includes(r.name.toLowerCase()))
          .filter((r) => max === undefined || r.baconNumber <= max)
          .map((r) => ({ name: r.name, exactBaconNumber: r.baconNumber }));
        return { source: "Cypher shortestPath, closed world", rows };
      }
      case "people_within": {
        const k = Number(args.k);
        const b = await bounds();
        const rows = b.filter((x) => x.bound <= k).map((x) => ({ name: x.name, provenWithin: k, tightestDerivedBound: x.bound }));
        return {
          source: "n20s: rules/costar.rules + rules/bacon-ladder.rules over the Bacon scope snapshot (open world)",
          count: rows.length,
          rows,
        };
      }
      case "explain_within": {
        const name = String(args.name);
        const b = await bounds();
        const person = b.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (!person) return { error: `No BaconWithin rung is derived for ${name} in the Bacon scope.` };
        const k = (args.k as number | undefined) ?? person.bound;
        if (k < person.bound) return { error: `The reasoner cannot prove ${person.name} is within ${k}; the tightest derived bound is ${person.bound}.` };
        await prepareProofGraph();
        const proof = await explainBacon(person.iri, k);
        const els = await fetchElements(proofElementIds(proof));
        const label = (iri: string) => els.nodes.find((n) => n.id === elementIdOf(iri))?.label ?? iri;
        return {
          source: "n20s.graph.explain (derivation trace)",
          statement: `${person.name} rdf:type ex:BaconWithin${k}`,
          steps: proof.steps.length,
          hops: proof.hops.map((h) => ({
            from: label(h.from),
            movie: label(h.movie),
            to: label(h.to),
            actedInRecords: h.via.map((v) => elementIdOf(v)),
          })),
        };
      }
      case "export_snapshot": {
        const r = await exportSnapshot(String(args.scope));
        return { nodes: r.nodes, relationships: r.relationships, quads: r.quads, ms: r.ms, trigStart: r.trig.slice(0, 1500) };
      }
      case "project_snapshot": {
        const r = await projectSnapshot("assistant", String(args.scope));
        return { graph: r.graphName, nodes: r.nodes, relationships: r.relationships, triples: r.triplesAfter, snapshotIri: r.snapshotIri };
      }
      case "movie_jsonld": {
        if (!bridged) {
          await applyBridge("schemaorg");
          bridged = true;
        }
        return movieJsonLd(String(args.title));
      }
      case "owl_profiles":
        return testOwlProfiles(["RDFS", "OWL_MICRO", "OWL_MINI"]);
      default:
        return { error: `Unknown tool ${name}` };
    }
  });
}

/** For tests and the UI: the comparison the assistant reasons about. */
export async function baconTable() {
  return compareBacon(await cypherBaconNumbers(), await bounds());
}

