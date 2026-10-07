# --- demo video (video/tools/*.py, from the demo-video skill) -----------------
SCRIPT    ?= demo-script.md
APP_TITLE ?= Movie Graph
TOOLS     ?= video/tools
# Record against a production build: no dev-server live reload can interrupt the take.
# `make preview` serves it on PREVIEW_PORT; APP_URL points the recorder at it.
PREVIEW_PORT ?= 5190
APP_URL   ?= http://localhost:$(PREVIEW_PORT)/
TARGET     = $(if $(APP_URL),--base-url $(APP_URL),--find-title "$(APP_TITLE)")

# GEMINI_API_KEY comes from .env (the same key the Assistant tab uses).
LOAD_ENV  = set -a; [ -f .env ] && . ./.env; set +a;

test:                                      ## the app's acceptance tests (reset the database first)
	cd app && npm test

video: video/audio/durations.json          ## narrated video, then the tests: the recording is an e2e run
	python3 $(TOOLS)/record.py --script $(SCRIPT) $(TARGET) --cursor
	python3 $(TOOLS)/assemble.py
	python3 $(TOOLS)/frames.py
	$(MAKE) test

video-silent:                              ## rehearsal: every selector, no TTS credits
	python3 $(TOOLS)/record.py --script $(SCRIPT) $(TARGET) --cursor --no-audio
	python3 $(TOOLS)/assemble.py --no-audio
	python3 $(TOOLS)/frames.py

video/audio/durations.json: $(SCRIPT)
	$(LOAD_ENV) python3 $(TOOLS)/tts.py --script $(SCRIPT)

preview:                                   ## build the app and serve it for recording (leave running)
	cd app && npm run build && npx vite preview --port $(PREVIEW_PORT) --strictPort

.PHONY: test video video-silent preview
