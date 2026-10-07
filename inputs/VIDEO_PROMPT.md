Add a narrated demo video to this repo, generated from the demo script. The pipeline is Playwright (drives the running app) → Gemini TTS (narration) → ffmpeg (assembly), all from `demo-script.md`.

## 1. Install the kit

- Unzip `movie-demo-video-kit.zip` at the repo root: `demo-script.md`, `Makefile`, `video/tools/*.py`.
- Add to `.gitignore`: `dist/`, `video/raw/`, `video/audio/`. The mp4 is a build artifact; the pipeline is the asset.
- Prerequisites: `python3 -m pip install playwright google-genai pyyaml && python3 -m playwright install chromium`, and check ffmpeg (`ffmpeg -hide_banner -filters | grep -q subtitles` tells whether libass is there; without it the tools fall back to PNG subtitles).
- Read `demo-script.md` entirely. The prose is for the presenter; the ```scene blocks drive the recorder. **Scene ids and narration are mine: do not change them.** If a scene cannot work as written, change its `actions`, `before` or `shot`, and tell me why.

## 2. Add the testids the scenes use

The recorder is a first-class consumer of the UI: add `data-testid` attributes, invisible and free. Two kinds:

- **targets** (buttons, inputs, containers to frame);
- **state markers**: a testid that only exists once the result it names is rendered, so `wait_for` means "this render is done", never a fixed delay.

| testid | Element | Visible when |
|---|---|---|
| `thesis` | Start: the three-column thesis | always on Start |
| `clear-db`, `load-movies` | Start: the two data buttons | as today |
| `db-empty`, `db-loaded` | Start: the data paragraph | empty / loaded state |
| `audit-toggle` | the audit drawer toggle **while closed** | drawer closed |
| `audit-close` | the same toggle **while open** (the testid switches) | drawer open |
| `audit-drawer-open` | the drawer | drawer open |
| `problem` | root of the `Problem` component (one per tab) | always |
| `scope-preset-rels`, `scope-preset-nodes` | Scenario 1 preset buttons (by preset id) | always |
| `scope-result-<presetId>` | the two-consumers block, suffixed with the preset whose query produced the result (`custom` otherwise) | after a run |
| `record-first-rel` | first relationship row of the records table | after a run |
| `record-inspector` | the inspector panel | after a run |
| `record-triples` | the inspector's triples table | once triples are loaded |
| `apply-bridge`, `break-it`, `validate` | Scenario 2 controls (`break-it` is the checkbox) | as today |
| `bridge-run-full`, `bridge-run-broken` | the pipeline table, suffixed by whether `01-years.rq` was skipped | after a bridge run |
| `shacl-result-ok`, `shacl-result-broken` | the SHACL summary, by violations = 0 or > 0 | after validation |
| `movie-select`, `gen-jsonld` | JSON-LD controls | as today |
| `jsonld-block`, `jsonld-split` | the code block / the block + rich-result container | after generation |
| `resource-callout` | the "why relationships are resources" callout | when shown |
| `bridge-schemaorg`, `bridge-wikidata` | Scenario 3 buttons | always |
| `invariants-<target>` | the invariants block, suffixed with the last target | after a run |
| `fingerprint-punchline` | the punchline shown once both bridges ran | both ran |
| `cypher-exact`, `profile-test`, `derive-ladder` | Scenario 4 buttons | always |
| `dist-chart`, `profiles` | Cypher distribution / profile results | after each run |
| `bacon-table`, `bacon-punchline`, `bacon-filter` | the comparison table, its punchline, the filter input | after the ladder |
| `prove-<slug(name)>` | the Prove button of a row, e.g. `prove-meg-ryan` | after the ladder |
| `proof`, `proof-path` | the proof block / its path | after explain |
| `proof-chip-movie-<i>` | the i-th Movie chip in the proof path | after explain |
| `focus-line` | the "Selected record … In Neo4j:" line | after a chip click |
| `bench-scope-all`, `bench-run`, `bench-result` | Benchmark preset, run button, isomorphism stat | result after a run |
| `layer-stack` | Layers tab stack | always |
| `chat-messages`, `chat-input`, `chat-suggestion-<i>` | Assistant | always |
| `chat-answer` | a final assistant answer bubble (not a tool-call line) | once answered |

`@neo4j-ndl/react` components may not forward `data-testid`: check how they pass HTML attributes, and wrap them if needed. Tabs are clicked by role (`role:tab=One snapshot`): verify the ndl tab bar renders `role="tab"` with those names; if not, add testids and update only the scene `actions`.

Run `npm test` after adding testids: nothing else may change.

## 3. Silent rehearsal until every scene passes

With the app running (`cd app && npm run dev`):

```bash
make video-silent
```

This exercises every selector without spending TTS credits. A failure names the scene. Iterate until all 24 scenes pass, then read `dist/frames/contact_sheet.png` with me, scene by scene: is the narrated thing in frame when the voice starts (left column), is anything covering it (right column, fix with a `before: dismiss`), is any scene idle or rushed (fix with `pad_s` or `fast_begin`/`fast_end`). Show me the sheet before going further.

## 4. Narrated render

- `GEMINI_API_KEY` is already in `.env` (the Assistant uses it); the Makefile loads it. Never print it, log it, or put it anywhere else.
- First verify the TTS model: `set -a; . ./.env; set +a; python3 video/tools/tts.py --list-models`. If `gemini-2.5-flash-preview-tts` is not listed, put the current Flash TTS model in the `scene-config` block. Do not guess model names.
- Generate the first two scenes' audio only and ask me to listen: I want to check how "n20s", "SHACL", "TriG" and "JSON-LD" are pronounced before synthesizing everything.
- Then `make video`: narration (cached), recording, assembly, contact sheet, then `make test`, since the recording mutates the database.

## 5. Finish

- Check nothing sensitive is on screen: no `.env` values, no local paths in the audit drawer.
- README: a short "Demo video" section (`make video-silent`, `make video`, re-run after UI changes, the failure names the scene).
- Commit the kit, the testids and the README. Do not commit `dist/` or audio. Ask me before pushing.

Report: scenes that needed action changes and why, the TTS model used, the final duration, and the contact sheet.