# Movie Graph → canonical RDF → n20s

**Scope first (Cypher), reason second (n20s).**

An internal Neo4j demo for SEs and product. It uses the Movie Graph (`:play movies`):
- snapshotted to RDF with [rdfsnapshot](https://github.com/halftermeyer/neo4j-rdf-snapshot);
- bridged to schema.org, or to Wikidata;
- reasoned over in memory with [n20s](https://github.com/halftermeyer/neo4j-n20s), which is Apache Jena running inside Neo4j.

Each scenario opens with the business problem, then runs live: real queries, real reasoning, nothing canned.

| | Scenario | The claim |
|---|---|---|
| 1 | **One snapshot, two consumers** | One Cypher scope goes both to `rdfsnapshot.export` (a TriG file) and to `n20s.graph.projectSnapshot` (in memory). The scope rules are shown live: `RETURN r` brings both endpoints, `RETURN n` brings no relationships, and extra columns are ignored. |
| 2 | **The web speaks schema.org** | A declarative bridge, validated with SHACL, produces a ready-to-embed JSON-LD block. The `ACTED_IN` record *is* the `schema:PerformanceRole`. |
| 3 | **Change the target, not the graph** | Switching the bridge folder to Wikidata changes the output. The database and the snapshot fingerprint stay the same. |
| 4 | **Six degrees, proven** | RDF derives `ex:coStar` and the `BaconWithin` ladder, and `n20s.graph.explain` gives the proof down to elementIds. RDF proves “within 2”; only Cypher knows “exactly 2”. |
| ⚖ | **Parity benchmark** | One button runs export and projection on the same scope, shows timings and triple counts, and checks that the two graphs are isomorphic. |
| 💬 | **Assistant** | Gemini, as a tool-calling loop over the typed query functions. Answers come from the graph and the reasoner, never from the LLM. |

## Prerequisites

- **Neo4j Enterprise 2026.09+** with these plugins in `plugins/`:
  - **rdfsnapshot 0.1.0** (`rdfsnapshot.export`)
  - **n20s**, a build that has `n20s.graph.projectSnapshot`
- Node 20+.

On startup the app checks that both plugins are present. If one is missing, it shows a blocking screen. An older Neo4j only gets a warning: the demo was built and tested on 2026.08.1, where both plugins already answer.

## Run

```bash
cp .env.example .env        # NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE, GEMINI_API_KEY
cd app
npm install                 # .npmrc sets legacy-peer-deps
npm run dev                 # http://localhost:5173
npm test                    # every scenario, against the live database
```

There is no seed script. Point the app at an empty database and click **Load the Movie Graph** on the Start tab. It runs `data/movies.cypher` (the `:play movies` script) statement by statement.

**Reset demo** (top right) drops every n20s graph, clears the database and reloads the data. You can use it at any time.

> ⚠️ Every `.env` key ends up in the browser bundle (Vite), including the Neo4j password and the Gemini key. **Local demo only.** `.env` is gitignored.

## The three layers

These are plain files. The app reads them as they are, shows them read-only (Layers tab, and inside each scenario), and sends them to n20s unchanged. To change a conclusion, edit a file. To add a target, add a folder under `bridge/`.

```
ontology/
  schemaorg.ttl          a local slice of schema.org, namespace https://schema.org/
                         (Movie, Person, PerformanceRole, Review, Rating, AggregateRating, …)
  movie-ext.ttl          ex:coStar, ex:Auteur, ex:BaconWithin0 … ex:BaconWithin6
bridge/schemaorg/
  axioms.ttl             lpg:label ⊑ rdf:type, l:Movie ⊑ schema:Movie, t:ACTED_IN ⊑ schema:PerformanceRole,
                         p:title ⊑ schema:name, …
  structure.rules        Jena rules: DIRECTED/WROTE/PRODUCED flipped into schema:director/author/producer,
                         ACTED_IN → PerformanceRole, REVIEWED → Review
  01-years.rq            CONSTRUCT: released/born integers → xsd:gYear
  02-character-names.rq  CONSTRUCT: ACTED_IN.roles list flattened into schema:characterName
  03-review-rating.rq    CONSTRUCT: REVIEWED.rating → schema:Rating
bridge/wikidata/
  axioms.ttl, structure.rules, 01-dates.rq, 02-character-names.rq
                         P31, P57 director, P58, P161 cast member (with statement nodes and P4633 qualifiers),
                         P162, P577 publication date, P569, P1476 title
rules/
  auteur.rules           directed and wrote the same movie
  aggregate-rating.rq    average rating from the reviews (a CONSTRUCT: Jena rules cannot aggregate)
  costar.rules           ex:coStar from two ACTED_IN records on the same movie
  bacon-ladder.owl.ttl   the stated definition: ∃ coStar . BaconWithin(k) ⊑ BaconWithin(k+1)
  bacon-ladder.rules     the executable form: one Jena rule per rung
  shapes.ttl             SHACL: what a schema.org consumer expects
```

The bridge pipeline (`applyBridge` in `app/src/lib/queries.ts`) runs in this order:
1. `projectSnapshot`
2. load the ontology and the axioms
3. materialise the CONSTRUCTs
4. forward-chain the bridge rules over the RDFS profile
5. apply the domain rules

### Pragmatic route: a `:Movie` record is a movie

The bridge treats a `:Movie` record as a movie: the record IRI stands for the film itself. The snapshot spec keeps **record ≠ thing** (SPEC §1). A strict pipeline would add a lifting step that mints separate IRIs for the things and links them to the records. The demo takes the pragmatic route on purpose and says so on screen in scenario 2.

## What was tested, and what we learned

- **Parity.** Export and projection of the same scope are isomorphic once `prov:generatedAtTime` is ignored. This is checked live in the Benchmark tab and by the tests, on three scopes, blank nodes from the `roles` lists included.
- **Bacon.** For every person in the Bacon scope (102 people), RDF's tightest bound equals Cypher's shortest path length. The tightest bound is the smallest `BaconWithin` rung among the derived facts. We read it and compare it; RDF does not compute Bacon numbers.
- **Which profile fires the OWL ladder?** This is tested live in scenario 4.
  - `OWL_MICRO` and `OWL_MINI` fire the `someValuesFrom` axioms, in under 0.1 s, but only once `ex:coStar` is *materialised* first: a profile does not see facts derived by rules stacked on top of it.
  - `RDFS` stays silent.
  - Full `OWL` does not finish in 15 s on 135 node records. Jena ignores the transaction timeout, so the app stops it by dropping the graph.
  - The per-rung Jena rules are the fallback, and they are what `n20s.graph.explain` replays for proofs.
- **CONSTRUCT round trip.** `n20s.graph.construct` returns Jena's short forms (`"1999"^^xsd:gYear`, bare strings). Before feeding the triples back through `n20s.graph.project`, a Cypher `CASE` rewrites them into n20s' `(s, p, o)` convention.

## Tests

`cd app && npm test`. The tests run against the database in `.env` and **reset it first**. They cover:
- bootstrap from an empty database;
- the scope rules;
- parity on three scopes;
- the bridges, SHACL, JSON-LD and Wikidata output;
- the database and snapshot staying unchanged across bridges;
- the Bacon bound = shortest path for every person, rules and OWL agreeing, the profile test, and explain → elementIds;
- the Assistant's tools.

## Layout

```
app/src/lib/neo4j.ts          driver singleton, runQuery, audit log grouped per action
app/src/lib/queries.ts        typed query functions (every scenario, the benchmark, the bridges)
app/src/lib/rdf.ts            TriG / n20s parsing, isomorphism, fingerprint
app/src/lib/layers.ts         the layer files, loaded as raw text
app/src/lib/assistantTools.ts Gemini tool declarations → typed functions
app/src/components/           one tab per scenario, hand-rolled SVG graph view, Cypher audit drawer
app/tests/                    vitest, live database
```

The UI follows [neo4j-rdf-fin-lineage](https://github.com/halftermeyer/neo4j-rdf-fin-lineage): React 19, Vite, `@neo4j-ndl/react`, and a global Cypher audit drawer. The Assistant uses `gemini-3.8-flash`, the newest Flash model available when this was built.
