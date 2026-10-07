"""Parse scenes from either a demo-script.md (fenced ```scene blocks) or a scenes.yaml.

The storyboard lives INSIDE the human-readable script so it cannot drift from it:

    ```scene
    id: s2-gaps
    actions:
      - click: "role:tab=Chronology"
      - wait_for: "testid:gap-table"
    narration: >
      The policy prescribes a control here. No control event exists.
    ```

Top-level settings (title, voice, viewport…) may be given in a ```scene-config block
or in a sibling scenes.yaml. Scene ids are a stable API: zero, duplicate or malformed
ids abort loudly. Narration is free to edit; ids are not.
"""
import re, sys
from pathlib import Path
import yaml

FENCE = re.compile(r"```scene(?P<kind>-config)?\s*\n(?P<body>.*?)\n```", re.S)
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,63}$")


def load(path: str) -> dict:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if p.suffix in (".yaml", ".yml"):
        cfg = yaml.safe_load(text) or {}
    else:
        cfg, scenes = {}, []
        for m in FENCE.finditer(text):
            block = yaml.safe_load(m.group("body")) or {}
            if m.group("kind"):
                cfg.update(block)
            else:
                scenes.append(block)
        cfg["scenes"] = scenes
        side = p.with_name("scenes.yaml")
        if side.exists():
            cfg = {**(yaml.safe_load(side.read_text()) or {}), **cfg}
    validate(cfg, path)
    return cfg


def validate(cfg: dict, src: str):
    scenes = cfg.get("scenes") or []
    if not scenes:
        sys.exit(f"✖ {src}: no scenes found (expected ```scene blocks or a scenes: list)")
    seen = set()
    for i, sc in enumerate(scenes):
        sid = str(sc.get("id", "")).strip()
        if not ID_RE.match(sid):
            sys.exit(f"✖ {src}: scene #{i+1} has missing/invalid id {sid!r} (lowercase, digits, - _)")
        if sid in seen:
            sys.exit(f"✖ {src}: duplicate scene id {sid!r}")
        seen.add(sid)
        if not sc.get("actions") and not sc.get("hook") and not sc.get("hold_s"):
            sys.exit(f"✖ {src}: scene {sid!r} has no actions, hook or hold_s")
    cfg["scenes"] = scenes


def narration(sc: dict) -> str:
    return " ".join(str(sc.get("narration", "")).split())
