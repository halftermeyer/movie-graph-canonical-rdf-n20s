Build an internal demo for neo4j: the Movie Graph, snapshotted to RDF, bridged to schema.org, reasoned over with n20s. Audience: Neo4j colleagues (SEs, product). Message: scope with Cypher, reason with RDF.

The UI should look like this one: https://github.com/halftermeyer/neo4j-rdf-fin-lineage (React 19 + TypeScript + Vite, @neo4j-ndl/react, neo4j-driver singleton, typed Cypher query functions, global Cypher audit drawer grouped per action, hand-rolled SVG graph view, one-click reset, Gemini assistant tab as a tool-calling loop over the query functions). Reuse its thesis framing: "Scope first (Cypher), reason second (n20s)".

The demo is built on:
- the Movie Graph dataset (`:play movies`): https://github.com/neo4j-graph-examples/movies/blob/main/scripts/movies.cypher
- the LPG → RDF snapshot format: https://github.com/halftermeyer/neo4j-rdf-snapshot (read docs/SPEC.md first; procedure rdfsnapshot.export)
- n20s: https://github.com/halftermeyer/neo4j-n20s (n20s.graph.projectSnapshot, infer, inferWithRules, construct, query, validate, explain)

Prerequisites: Neo4j 2026.09+ Enterprise with the rdfsnapshot 0.1.0 and n20s plugins installed. At startup, check both are present and show a clear blocking message if not.

Three layers, each a folder of plain RDF/SPARQL/rule files, shown read-only in the UI. The point is that they are declarative and swappable:
- ontology/: a local schema.org slice (Movie, Person, PerformanceRole, Review, Rating; namespace https://schema.org/, say so in the README) and a small extension movie-ext.ttl (ex:coStar, ex:Auteur, ex:BaconWithin0 to ex:BaconWithin6)
- bridge/schemaorg/: RDFS axioms (lpg:label rdfs:subPropertyOf rdf:type, l:Movie rdfs:subClassOf schema:Movie, p:title rdfs:subPropertyOf schema:name…) plus CONSTRUCT or Jena rules for what axioms can't express: DIRECTED/WROTE/PRODUCED flipped into schema:director/author/producer; the ACTED_IN record becomes a schema:PerformanceRole (roles list flattened into schema:characterName); the REVIEWED record becomes a schema:Review with its rating; released/born integers become xsd:gYear
- bridge/wikidata/: the same snapshot mapped to Wikidata properties instead (P57 director, P161 cast member, P1476 title, P577 publication date)
- rules/: domain rules (ex:Auteur = directed and wrote the same movie; aggregate rating from reviews; ex:coStar from ACTED_IN records; the Bacon ladder) and shapes.ttl (a few SHACL shapes for what a schema.org consumer expects)

Each scenario is a sales argument, not just a screen: open with a synthetic, visual statement of the business problem, then demonstrate the solution's value live at execution — run the actual query/algorithm in front of the audience, not a canned result.

1. "One snapshot, two consumers": the same scope query goes to rdfsnapshot.export (TriG shown, download button) and to n20s.graph.projectSnapshot (in memory). Show the records (lpg:label, lpg:type, relationships as resources). Show the scope rules live: `RETURN r` brings both endpoints, `RETURN n` brings no relationships, extra columns like `length(p)` are ignored.
2. "The web speaks schema.org": apply the bridge, validate with SHACL, output a ready-to-embed schema.org JSON-LD block for a selected movie. Show why relationships are resources: the ACTED_IN record IS the schema:PerformanceRole.
3. "Change the target, not the graph": switch the bridge to Wikidata. Graph and snapshot untouched, output changes.
4. "Six degrees, proven": scope with the Movie Graph guide's Bacon query (shortestPath from Kevin Bacon over ACTED_IN, up to 4 co-star hops). RDF derives ex:coStar and the BaconWithin ladder: OWL someValuesFrom axioms are the stated definition; test which n20s profile fires them and fall back to one Jena rule per rung. n20s explain renders the proof as a path, each step clickable back to the record's elementId and highlighted in the graph view. Side by side for each person: Cypher's exact Bacon number vs RDF's tightest bound. Punchline on screen: RDF proves "within 2", only Cypher knows "exactly 2" (open world vs closed world). Never claim RDF computes Bacon numbers.

Make the parity claim demonstrable live with a dynamic benchmark the presenter can trigger on the spot: a button that runs export and projection on the same scope, shows timings and triple counts, and checks the two graphs are isomorphic (ignoring prov:generatedAtTime).

Tests: for every person in the Bacon scope, the RDF tightest bound equals Cypher's shortest path length; every scenario's queries are machine-tested.

Say once, in the README and on screen in scenario 2, that the bridge treats a :Movie record as a movie: the pragmatic route, versus the spec's record ≠ thing distinction.

The demo must be resettable at any time (drop n20s graphs, clear the database, reload), and must bootstrap from an empty database with data ingestion triggered from within the app itself — not a separate seed script.

Create the .env (or a .env.example to copy) with the keys you need — NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, NEO4J_DATABASE, GEMINI_API_KEY — and ask me to fill in whatever isn't already available. Never commit .env. The Gemini key ends up in the browser bundle: local demo only.

The Assistant tab answers questions like "who is within 2 of Kevin Bacon, and why?" by calling the typed query functions (Cypher, export, project, infer, explain). Answers come from the graph and the reasoner, never from the LLM. Use the same Gemini model as the reference repo unless a newer one is available.

Once the demo is built and I've validated it, enrich the README with screenshots of the running app. Then ask me before creating a GitHub repo for it under halftermeyer/* (suggested name: neo4j-movies-rdf-snapshot) — don't create one unilaterally.

First grant yourself most of the permissions you may need and validate the draft with me.