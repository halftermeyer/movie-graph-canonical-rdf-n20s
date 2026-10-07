# Demo script: Movie Graph → canonical RDF → n20s

**Audience:** Neo4j colleagues (SEs, product). **Live length:** 15 to 20 minutes. **Video:** about 6 minutes, generated from the `scene` blocks below (`make video`).

**The one sentence to leave behind:** scope first with Cypher, reason second with RDF, and every answer can be traced back to a database record.

This file serves two readers. The prose is for the presenter. The fenced `scene` blocks are read by the video recorder (`video/tools/record.py`). Keep them side by side so the spoken demo and the video never drift apart. Scene ids are a stable API: edit narration freely, never ids.

```scene-config
title: "Movie Graph → RDF → n20s"
subtitle: "Scope first with Cypher, reason second with RDF"
viewport: { width: 1920, height: 1080 }
pad_s: 1.0
voice: "Charon"
tts_model: "gemini-2.5-flash-preview-tts"   # verify with: python3 video/tools/tts.py --list-models
tts_style: "Speak calmly and clearly, like a senior engineer walking colleagues through a design."
```

## Before you start (live demo)

- Neo4j 2026.09+ Enterprise running, with the rdfsnapshot 0.1.0 and n20s plugins installed. The app blocks with a clear message if either is missing.
- `cd app && npm run dev`, open http://localhost:5173.
- Click **Reset demo** once, a few minutes before the audience arrives, then **Clear database** so you can show the bootstrap live.
- Open the Cypher audit drawer only when you mean to show it: it covers part of the screen.

## Act 0. Bootstrap (1 min)

Say: the demo starts from an empty database on purpose. Nothing is pre-baked. The Start tab shows the thesis in three columns: Cypher picks the records, rdfsnapshot serializes them mechanically, n20s reasons over them with plain files.

Click **Load the Movie Graph**. It runs the `:play movies` script statement by statement, from the app.

```scene
id: bootstrap
before:
  - dismiss: "testid:audit-close"
actions:
  - goto: "/"
  - wait_for: "testid:thesis"
  - fast_begin: true
  - dismiss: "testid:clear-db"
  - wait_for: "testid:db-empty"
  - click: "testid:load-movies"
  - wait_for: "testid:db-loaded"
  - fast_end: true
shot: "testid:thesis"
narrate: at_start
narration: >
  Scope first with Cypher, reason second with RDF. We start from an empty database
  and load the Movie Graph, the one everyone knows from play movies. Cypher picks the
  records, a snapshot serializes them mechanically, and n20s, Apache Jena running
  inside Neo4j, reasons over them with plain files.
```

## Act 1. One snapshot, two consumers (4 min)

**The problem.** Every RDF consumer gets its own hand-written export. Mappings drift, counts stop matching, and nobody can say which records an inference came from.

```scene
id: s1-problem
actions:
  - click: "role:tab=One snapshot"
  - wait_for: "testid:problem"
shot: "testid:problem"
narration: >
  Scenario one. Today, every RDF consumer gets its own hand-written export from the
  graph. The mappings drift, the counts stop matching, and nobody can say which
  records an inference came from.
```

**Live.** Click the `RETURN r` preset (the cast of The Matrix, relationships only). The same Cypher goes to `rdfsnapshot.export` (a TriG file) and to `n20s.graph.projectSnapshot` (in memory). Point at the matching counts, then at the closure rule: only relationships were returned, yet both endpoints came along.

```scene
id: s1-two-consumers
actions:
  - click: "testid:scope-preset-rels"
  - wait_for: "testid:scope-result-rels"
shot: "testid:scope-result-rels"
narration: >
  The scope is plain Cypher: the cast of The Matrix, returning only relationships.
  The same query goes to the export procedure, which writes a TriG file, and to n20s,
  which projects it in memory. Same records, same counts. And both endpoints came
  along: that is the closure rule.
```

Click a relationship row. Say: a relationship is a resource, with its own IRI, type, endpoints, properties and element ID. No mapping, no template. **Records, not things**: the snapshot describes the database, not the world.

```scene
id: s1-record
actions:
  - click: "testid:record-first-rel"
  - wait_for: "testid:record-triples"
shot: "testid:record-inspector"
narration: >
  Click a record. A relationship is a resource: its own IRI, its type, its endpoints,
  its properties, and its element ID. No mapping, no template. The snapshot describes
  database records, not things in the world.
```

Click the `RETURN n` preset: no relationship is in scope, even though they exist. The snapshot holds exactly what the query names. (If someone asks: the `RETURN path, length(path)` preset shows that paths are decomposed and extra columns are ignored.)

```scene
id: s1-return-n
actions:
  - click: "testid:scope-preset-nodes"
  - wait_for: "testid:scope-result-nodes"
shot: "testid:scope-result-nodes"
narration: >
  Now return the nodes only. No relationship is in scope, even though they exist in
  the graph. The snapshot holds exactly what the query names, and nothing more.
```

Open the audit drawer once: every statement the app runs is there, grouped per action, copyable, replayable in Browser.

```scene
id: s1-audit
actions:
  - click: "testid:audit-toggle"
  - wait_for: "testid:audit-drawer-open"
shot: "testid:audit-drawer-open"
narration: >
  Every statement the app runs lands in this audit drawer, grouped per action,
  copyable, and replayable in Neo4j Browser. Nothing on screen is canned.
```

## Act 2. The web speaks schema.org (4 min)

**The problem.** The graph knows the movie; a search engine doesn't. The data is in Neo4j in the graph's own words (`:Movie`, `ACTED_IN.roles`, `REVIEWED.rating`), the consumer wants schema.org, and hand-coded exports rot.

```scene
id: s2-problem
before:
  - dismiss: "testid:audit-close"
actions:
  - click: "role:tab=schema.org"
  - wait_for: "testid:problem"
shot: "testid:problem"
narration: >
  Scenario two. The graph knows the movie; a search engine does not. The data is in
  Neo4j in the graph's own words, while the consumer wants schema.org. Hand-coding
  that export, page by page, is the usual answer, and it rots.
```

**Live.** Apply the bridge. Walk the pipeline table: RDFS axioms, Jena rules, three CONSTRUCTs, in order. Read the "pragmatic route" note aloud: here a `:Movie` record stands for the movie; the spec keeps record ≠ thing, and a strict pipeline would add a lifting step.

```scene
id: s2-bridge
actions:
  - click: "testid:apply-bridge"
  - fast_begin: true
  - wait_for: "testid:bridge-run-full"
  - fast_end: true
shot: "testid:bridge-run-full"
narration: >
  The bridge is a folder of plain files: RDFS axioms, a few Jena rules, and three
  SPARQL CONSTRUCTs. n20s applies them, in order, to the snapshot. Note the choice
  stated on screen: here, a Movie record stands for the movie itself.
```

Tick **Break it** (skips `01-years.rq`), re-run, validate: SHACL catches it, no movie has a `schema:datePublished`. Untick, re-run, validate: zero violations.

```scene
id: s2-break
actions:
  - click: "testid:break-it"
  - click: "testid:apply-bridge"
  - wait_for: "testid:bridge-run-broken"
  - click: "testid:validate"
  - wait_for: "testid:shacl-result-broken"
shot: "testid:shacl-result-broken"
narration: >
  Break it on purpose: skip the file that turns release years into dates. SHACL
  catches it at once. No movie has a publication date, so no consumer would accept
  this output.
```

```scene
id: s2-fix
actions:
  - click: "testid:break-it"
  - click: "testid:apply-bridge"
  - wait_for: "testid:bridge-run-full"
  - click: "testid:validate"
  - wait_for: "testid:shacl-result-ok"
shot: "testid:shacl-result-ok"
narration: >
  Put the file back and run it again. Zero violations: every movie, person, role,
  review and rating has what a schema.org consumer expects.
```

Pick **The Da Vinci Code** (two reviews, so the aggregate rating is visible) and generate the JSON-LD. Show the rich-result preview next to it.

```scene
id: s2-jsonld
actions:
  - select: { target: "testid:movie-select", value: "The Da Vinci Code" }
  - click: "testid:gen-jsonld"
  - wait_for: "testid:jsonld-block"
shot: "testid:jsonld-split"
narration: >
  Pick The Da Vinci Code and generate the block a search engine reads: director,
  cast with their characters, and an aggregate rating computed from the reviews.
  Ready to embed in a page, straight from the graph.
```

Scroll to the callout. This is the moment that justifies relationships as resources: the PerformanceRole's `@id` is the IRI of the `ACTED_IN` record. Nothing was invented.

```scene
id: s2-role
actions:
  - wait_for: "testid:resource-callout"
shot: "testid:resource-callout"
narration: >
  Look at the performance role. Its ID is the IRI of the acted-in relationship
  record. Nothing was invented: the record is the role. That is why the snapshot
  keeps relationships as resources.
```

## Act 3. Change the target, not the graph (2 min)

**The problem.** A new consumer usually means a new pipeline: new code, sometimes a copy of the data, sometimes a remodelled graph.

**Live.** Run the schema.org bridge (the reference), then the Wikidata one. Point at the three invariants: database unchanged, snapshot fingerprint identical, output changed. Only the bridge folder moved.

```scene
id: s3-schemaorg
actions:
  - click: "role:tab=Wikidata"
  - click: "testid:bridge-schemaorg"
  - fast_begin: true
  - wait_for: "testid:invariants-schemaorg"
  - fast_end: true
shot: "testid:invariants-schemaorg"
narration: >
  Scenario three. Usually, a new consumer means a new pipeline. Here we keep the same
  scope and the same snapshot, and run the schema.org bridge first, as the reference.
  The database is unchanged, and the snapshot fingerprint is recorded.
```

```scene
id: s3-wikidata
actions:
  - click: "testid:bridge-wikidata"
  - fast_begin: true
  - wait_for: "testid:fingerprint-punchline"
  - fast_end: true
shot: "testid:fingerprint-punchline"
narration: >
  Now swap the folder for Wikidata: director, cast member with character qualifiers,
  publication date. The database did not move, and the two snapshot fingerprints are
  identical. Only the bridge changed, and with it, the output.
```

## Act 4. Six degrees, proven (5 min)

**The problem.** "Is Meg Ryan within two hops of Kevin Bacon? Prove it." A number alone is not evidence, and "within 2" must never be read as "exactly 2".

```scene
id: s4-problem
actions:
  - click: "role:tab=Six degrees"
  - wait_for: "testid:problem"
shot: "testid:problem"
narration: >
  Scenario four. Is Meg Ryan within two hops of Kevin Bacon? Prove it. A number alone
  is not evidence, and a reasoner that says within two must never be read as exactly
  two.
```

**Live, step 1: Cypher measures.** The scope is the Movie Graph guide's own `shortestPath` query. Cypher gives exact Bacon numbers: a closed-world computation over the whole graph.

```scene
id: s4-cypher
actions:
  - click: "testid:cypher-exact"
  - wait_for: "testid:dist-chart"
shot: "testid:dist-chart"
narration: >
  Cypher first. The Movie Graph guide's shortest path query scopes Kevin Bacon's
  neighbourhood and measures exact distances. That is a closed-world computation:
  Cypher sees the whole graph, so it knows exactly.
```

**Step 2: which profile fires the OWL ladder?** The ladder is a definition in `rules/bacon-ladder.owl.ttl`. The profile test runs live; full OWL is the slow one, so the video fast-forwards it. Say why co-star is materialized first: a profile does not see facts derived by rules stacked on top of it.

```scene
id: s4-profiles
actions:
  - click: "testid:profile-test"
  - fast_begin: true
  - wait_for: "testid:profiles"
  - fast_end: true
shot: "testid:profiles"
narration: >
  In RDF, the ladder is a definition, written in OWL: a co-star of someone within k
  is within k plus one. Which Jena profile fires it? We test them live. The
  executable fallback is one rule per rung, and it is what explain replays.
```

**Step 3: RDF proves.** Derive co-stars and the ladder. Read the punchline: RDF proves "within 2", only Cypher knows "exactly 2". Open world: a missing co-star triple is not proof that the co-star does not exist. The table agreeing for everyone is a check we run, not something RDF computes. Never say RDF computes Bacon numbers.

```scene
id: s4-ladder
actions:
  - click: "testid:derive-ladder"
  - fast_begin: true
  - wait_for: "testid:bacon-table"
  - fast_end: true
shot: "testid:bacon-punchline"
narration: >
  Derive co-stars from the acted-in records and climb the ladder. RDF proves within
  two. Only Cypher knows exactly two: in an open world, a missing co-star triple is
  not proof there is none. The bounds agree with Cypher for everyone in scope. That
  is a check we run, not something RDF computes.
```

**Step 4: the proof is the path.** Filter on Meg Ryan, click **Prove**. The explain trace becomes a path of records: person, ACTED_IN record, movie, ACTED_IN record, co-star, down to Kevin Bacon. Click a step: the app gives the Cypher that fetches that exact record by elementId.

```scene
id: s4-proof
actions:
  - fill: { target: "testid:bacon-filter", value: "Meg Ryan" }
  - click: "testid:prove-meg-ryan"
  - wait_for: "testid:proof-path"
shot: "testid:proof"
narration: >
  Now the proof for Meg Ryan. n20s explain replays the derivation: Meg Ryan, an
  acted-in record, a movie, another record, a co-star, all the way down to Kevin
  Bacon. The proof is the path, and every step is a database record.
```

```scene
id: s4-record
actions:
  - click: "testid:proof-chip-movie-0"
  - wait_for: "testid:focus-line"
shot: "testid:focus-line"
narration: >
  Click any step and you get the Cypher that fetches that exact record in Neo4j, by
  element ID. From an inference back to the graph, in one click.
```

## Act 5. Parity, layers, assistant (3 min)

**Benchmark.** Two code paths implement the same spec. Pick "Whole graph", run: export, projection, isomorphism check with blank nodes, ignoring only `prov:generatedAtTime`. Run it again on another scope if someone doubts it.

```scene
id: bench
actions:
  - click: "role:tab=Benchmark"
  - click: "testid:bench-scope-all"
  - click: "testid:bench-run"
  - fast_begin: true
  - wait_for: "testid:bench-result"
  - fast_end: true
shot: "testid:bench-result"
narration: >
  Two code paths implement the same spec: the export procedure and the n20s
  projection. On the whole graph, with the same snapshot ID, we export, project, and
  run a graph isomorphism check, blank nodes included. Isomorphic: the file and the
  reasoner hold the same graph.
```

**Layers.** Nothing in them is code. Edit a file to change a conclusion; add a folder under `bridge/` to add a target.

```scene
id: layers
actions:
  - click: "role:tab=Layers"
  - wait_for: "testid:layer-stack"
shot: "testid:layer-stack"
narration: >
  None of this is code. The ontology, the bridges, the rules and the shapes are plain
  files, read as they are and sent to n20s unchanged. Edit a file to change a
  conclusion. Add a folder to add a target.
```

**Assistant.** Ask "Who is within 2 of Kevin Bacon, and why?". Point at the tool calls: Gemini can only call the typed functions. The answer comes from the graph and the reasoner, never from the model. This is the one nondeterministic step: in the video it is kept last and defended with a fallback.

```scene
id: assistant
before:
  - dismiss: "testid:audit-close"
actions:
  - click: "role:tab=Assistant"
  - try:
      timeout_ms: 5000
      actions:
        - click: "testid:chat-suggestion-0"
      fallback:
        - type: { target: "testid:chat-input", value: "Who is within 2 of Kevin Bacon, and why?", delay_ms: 30 }
        - press: "Enter"
  - fast_begin: true
  - wait_any:
      targets: ["testid:chat-answer"]
      timeout_ms: 90000
  - fast_end: true
shot: "testid:chat-messages"
narration: >
  Last, ask in plain language: who is within two of Kevin Bacon, and why? Gemini can
  only call the typed functions: Cypher, export, project, infer, explain. The tool
  calls are on screen. The answer comes from the graph and the reasoner, never from
  the model.
```

```scene
id: outro
actions:
  - click: "role:tab=Start"
  - wait_for: "testid:thesis"
shot: "testid:thesis"
narration: >
  Scope with Cypher. Snapshot mechanically, as records. Reason with plain files you
  can swap, and prove every answer back to the graph. The snapshot format, n20s and
  this demo are on GitHub.
```

## Objections you will get, and the answers

| Objection | Answer |
|---|---|
| "n10s already exports RDF." | The snapshot is a spec with a conformance suite: records only, relationships as resources, no mapping inside. Its value is that two consumers (a file and an in-memory reasoner) provably see the same graph (Benchmark tab). |
| "Why not a mapping template, R2RML-style?" | A mapping is already interpretation. Keeping the snapshot mechanical puts all interpretation in standard, swappable files (Act 3). |
| "Cypher computes auteurs and Bacon numbers in one line." | Agreed, and the demo says so. RDF adds definitions, proofs down to records, standard vocabularies and validation. Different questions (Act 4). |
| "A Movie record is not a movie." | Correct, and the demo says it on screen. This is the pragmatic route; a strict pipeline adds a lifting step that mints IRIs for things. |
| "Is it fast enough?" | Scope first: reason over a perimeter, not the whole database. Timings are live in every tab. Full OWL is slow even here, which is why the profile test exists. |
| "Are element IRIs stable?" | Within a snapshot only (SPEC §5). Anything durable is recomputed from the snapshot by rules. |
| "Is the assistant making things up?" | The tool calls are visible, and the answer only restates tool results. |

## Making the video

```bash
make video-silent   # rehearsal: every selector, no TTS credits
make video          # narrated: dist/demo.mp4 + dist/demo.srt, then runs the tests
```

Re-run after any UI change: a broken selector aborts with the scene id. Review `dist/frames/contact_sheet.png` after each render: left column is what is on screen when the voice starts, right column is mid-scene.
