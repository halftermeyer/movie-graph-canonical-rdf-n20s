#!/usr/bin/env python3
"""Record a demo video by driving a web app scene by scene with Playwright.

Reads scenes from demo-script.md (fenced ```scene blocks) or scenes.yaml, holds each
scene for max(action time, narration + pad), and writes:
  video/raw/session.webm   one continuous take
  video/scenes.json        [{id, start_s, end_s, narration}] for assemble.py
  video/raw/title.png      title card rendered by the browser (same fonts as the app)
  video/raw/cues/*.png     one PNG per subtitle cue (used when ffmpeg lacks libass)

Usage:
  record.py --script demo-script.md [--base-url URL | --find-title "App title"]
            [--no-audio] [--wps 2.6] [--cursor] [--headed] [--out video]
Every wait failure aborts naming the SCENE, not just the selector.

Each scene has three parts, not two: `before` (enter clean: dismiss what a previous scene
left open), `actions`, `shot` (what the camera frames — auto-scroll follows the CONTROLS you
click, which sit at the top; the CONSEQUENCES render below). `fast_begin`/`fast_end` bracket
boring intervals that assemble.py compresses; hold arithmetic below runs in compressed time.
"""
import argparse, importlib.util, json, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
from scenes_parser import load, narration as narr
from remap import Remap, K, LEAD_S, MIN_S

CURSOR_JS = """
(() => { if (window.__demoCursor) return;
 const c = document.createElement('div'); c.id='__demo_cursor';
 c.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;'
 +'background:rgba(255,200,0,.35);border:2px solid rgba(255,140,0,.9);pointer-events:none;'
 +'transform:translate(-50%,-50%);transition:left .12s,top .12s;left:-50px;top:-50px';
 document.documentElement.appendChild(c);
 window.__demoCursor = (x,y,click)=>{c.style.left=x+'px';c.style.top=y+'px';
   if(click){c.style.background='rgba(255,80,0,.6)';setTimeout(()=>c.style.background='rgba(255,200,0,.35)',180);}};
})();"""

TITLE_HTML = """<html><body style="margin:0;width:{w}px;height:{h}px;display:flex;flex-direction:column;
align-items:center;justify-content:center;background:linear-gradient(135deg,#0b1a2a,#123a5c);
font-family:{font};color:#fff"><div style="font-size:64px;font-weight:600;letter-spacing:-.01em">{title}</div>
<div style="font-size:30px;color:#b8c7d6;margin-top:22px">{subtitle}</div></body></html>"""

BADGE_HTML = """<html><body style="margin:0;width:{w}px;height:{h}px;background:transparent;font-family:{font}">
<div style="position:absolute;top:24px;right:28px;background:rgba(0,0,0,.7);color:#fff;font-size:{fs}px;
padding:8px 14px;border-radius:6px;letter-spacing:.02em">&#9193; fast-forwarded</div></body></html>"""

CUE_HTML = """<html><body style="margin:0;width:{w}px;height:{h}px;display:flex;align-items:flex-end;
justify-content:center;background:transparent;font-family:{font}"><div style="margin-bottom:40px;
background:rgba(0,0,0,.62);color:#fff;font-size:{fs}px;line-height:1.35;padding:10px 18px;border-radius:6px;
max-width:70%;text-align:center">{text}</div></body></html>"""


# ---------- targets -------------------------------------------------------------
def locate(page, target: str):
    kind, _, val = str(target).partition(":")
    if kind == "testid":
        return page.get_by_test_id(val)
    if kind == "role":                      # role:tab=Chronology  (library components you don't own)
        role, _, name = val.partition("=")
        return page.get_by_role(role, name=name or None).first
    if kind == "text":
        return page.get_by_text(val, exact=False).first
    if kind == "css":
        return page.locator(val).first
    raise ValueError(f"bad target {target!r}: testid:<id> | role:<role>=<name> | text:<text> | css:<sel>")


def move_cursor(page, loc, click=False):
    try:
        box = loc.bounding_box()
        if box:
            page.evaluate("([x,y,c])=>window.__demoCursor&&window.__demoCursor(x,y,c)",
                          [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, click])
            page.wait_for_timeout(160)
    except Exception:
        pass


# ---------- actions -------------------------------------------------------------
class Ctx:
    def __init__(self, page, base_url, hooks, cursor):
        self.page, self.base_url, self.hooks, self.cursor = page, base_url, hooks, cursor
        self.timeout = 30_000            # per-wait timeout; `try` lowers it for the primary path
        self.t0 = None                   # recording start (set by main)
        self.fast = []                   # [(begin, end)] real-time windows to compress
        self._fast_open = None


def run_actions(ctx, actions, sid):
    for action in actions or []:
        run_action(ctx, action, sid)


def run_action(ctx, action, sid):
    page = ctx.page
    (name, arg), = action.items()
    if name == "goto":
        url = arg if str(arg).startswith("http") else ctx.base_url.rstrip("/") + "/" + str(arg).lstrip("/")
        page.goto(url, wait_until="networkidle")
        if ctx.cursor: page.evaluate(CURSOR_JS)
    elif name in ("click", "hover"):
        loc = locate(page, arg); loc.wait_for(state="visible", timeout=ctx.timeout)
        if ctx.cursor: move_cursor(page, loc, click=(name == "click"))
        getattr(loc, name)()
    elif name == "fill":
        loc = locate(page, arg["target"]); loc.wait_for(state="visible", timeout=ctx.timeout)
        if ctx.cursor: move_cursor(page, loc, click=True)
        loc.click(); loc.fill(str(arg["value"]))
    elif name == "type":                                  # human-paced typing
        loc = locate(page, arg["target"]); loc.click()
        loc.press_sequentially(str(arg["value"]), delay=int(arg.get("delay_ms", 35)))
    elif name == "select":
        locate(page, arg["target"]).select_option(str(arg["value"]))
    elif name == "press":
        if isinstance(arg, dict): locate(page, arg["target"]).press(arg["key"])
        else: page.keyboard.press(str(arg))
    elif name == "wait_for":                              # deterministic: must exist
        locate(page, arg).wait_for(state="visible", timeout=ctx.timeout)
    elif name == "wait_any":                              # nondeterministic (LLM output…): any of several
        targets = arg["targets"] if isinstance(arg, dict) else arg
        timeout = int(arg.get("timeout_ms", 60_000)) if isinstance(arg, dict) else 60_000
        deadline = time.monotonic() + timeout / 1000
        while time.monotonic() < deadline:
            for t in targets:
                try:
                    if locate(page, t).is_visible(): return
                except Exception:
                    pass
            page.wait_for_timeout(250)
        raise PWTimeout(f"none of {targets} became visible in {timeout} ms")
    elif name == "wait_ms":
        page.wait_for_timeout(int(arg))
    elif name == "dismiss":                               # enter clean: click only if visible, never fail
        try:
            loc = locate(page, arg)
            if loc.is_visible(timeout=800): loc.click(); page.wait_for_timeout(250)
        except Exception:
            pass
    elif name == "fast_begin":                            # start of an interval assemble.py will compress
        ctx._fast_open = time.monotonic() - ctx.t0
    elif name == "fast_end":
        if ctx._fast_open is None: raise ValueError("fast_end without fast_begin")
        ctx.fast.append((ctx._fast_open, time.monotonic() - ctx.t0)); ctx._fast_open = None
    elif name == "shot":                                  # frame the narrated content; hard assertion
        frame_on(ctx, arg, sid)
    elif name == "try":                                   # try: {actions: [...], fallback: [...], timeout_ms: 5000}
        saved, ctx.timeout = ctx.timeout, int(arg.get("timeout_ms", 5_000))
        try:
            run_actions(ctx, arg.get("actions"), sid)
        except PWTimeout as e:
            ctx.timeout = saved
            if not arg.get("fallback"): raise
            print(f"  ↻ {sid}: primary path failed ({str(e).splitlines()[0]}); running fallback", flush=True)
            run_actions(ctx, arg["fallback"], sid)
        finally:
            ctx.timeout = saved
    elif name == "hook":
        fn = getattr(ctx.hooks, str(arg), None)
        if fn is None: raise RuntimeError(f"hook {arg!r} not found in video/hooks.py")
        fn(page, {"id": sid})
    else:
        raise ValueError(f"unknown action {name!r}")


def frame_on(ctx, target, sid):
    """Scroll the narrated content into view. Smooth = reads as camera movement, not a jump cut.
    Missing target = broken scene (the narration describes something that is not there)."""
    loc = locate(ctx.page, target)
    loc.wait_for(state="visible", timeout=ctx.timeout)
    loc.evaluate("el => el.scrollIntoView({behavior: 'smooth', block: 'center'})")
    ctx.page.wait_for_timeout(700)


def load_hooks(path: Path):
    if not path.exists(): return object()
    spec = importlib.util.spec_from_file_location("demo_hooks", path)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod


def find_by_title(p, title, ports=range(5170, 5200)):
    """Don't hardcode the dev-server port: probe for a page whose <title> contains `title`."""
    b = p.chromium.launch()
    for port in ports:
        url = f"http://localhost:{port}/"
        pg = b.new_page()                      # fresh page: a refused goto poisons the previous one
        try:
            pg.goto(url, timeout=1500)
            if title.lower() in pg.title().lower():
                b.close(); return url
        except Exception:
            continue
        finally:
            pg.close()
    b.close(); sys.exit(f"✖ no page titled like {title!r} on localhost:{ports.start}-{ports.stop - 1}")


def render_png(p, html, vp, out, transparent=False):
    b = p.chromium.launch(); pg = b.new_page(viewport=vp)
    pg.set_content(html); pg.wait_for_timeout(200)
    pg.screenshot(path=str(out), omit_background=transparent); b.close()


# ---------- main ----------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", default="demo-script.md", help="demo-script.md with ```scene blocks, or scenes.yaml")
    ap.add_argument("--base-url"); ap.add_argument("--find-title", help="probe localhost ports for this page title")
    ap.add_argument("--out", default="video")
    ap.add_argument("--no-audio", action="store_true", help="silent rehearsal; hold = words / --wps")
    ap.add_argument("--wps", type=float, default=2.6, help="words per second for the silent estimate")
    ap.add_argument("--cursor", action="store_true"); ap.add_argument("--headed", action="store_true")
    ap.add_argument("--font", default="Inter, 'Helvetica Neue', Arial, sans-serif")
    a = ap.parse_args()

    cfg = load(a.script)
    vp = cfg.get("viewport", {"width": 1920, "height": 1080})
    pad_default = float(cfg.get("pad_s", 1.0))
    out = Path(a.out); raw = out / "raw"; cues = raw / "cues"
    for d in (raw, cues): d.mkdir(parents=True, exist_ok=True)
    hooks = load_hooks(out / "hooks.py")

    durations = {}
    if not a.no_audio:
        dpath = out / "audio" / "durations.json"
        if not dpath.exists(): sys.exit("✖ no video/audio/durations.json — run tts.py first, or pass --no-audio")
        durations = json.loads(dpath.read_text())

    with sync_playwright() as p:
        base_url = a.base_url or (find_by_title(p, a.find_title) if a.find_title
                                  else cfg.get("base_url", "http://localhost:5173"))
        print(f"app: {base_url}")

        # title card typeset by the browser: no ffmpeg drawtext, no font-path hell
        render_png(p, TITLE_HTML.format(w=vp["width"], h=vp["height"], font=a.font,
                                        title=cfg.get("title", "Demo"), subtitle=cfg.get("subtitle", "")),
                   vp, raw / "title.png")

        browser = p.chromium.launch(headless=not a.headed)
        pw_ctx = browser.new_context(viewport=vp, record_video_dir=str(raw / "_rec"),
                                     record_video_size=vp, color_scheme="light")
        page = pw_ctx.new_page()
        if a.cursor: page.add_init_script(CURSOR_JS)
        ctx = Ctx(page, base_url, hooks, a.cursor)

        timeline, t0 = [], time.monotonic()
        ctx.t0 = t0
        k = float(cfg.get("fast_factor", K)); lead = float(cfg.get("fast_lead_s", LEAD_S)); min_s = float(cfg.get("fast_min_s", MIN_S))
        for sc in cfg["scenes"]:
            sid, text = sc["id"], narr(sc)
            start = time.monotonic() - t0
            print(f"▶ scene {sid} @ {start:6.1f}s", flush=True)
            n_fast_before = len(ctx.fast)
            try:
                run_actions(ctx, sc.get("before"), sid)                 # enter clean
                if sc.get("hook"): run_action(ctx, {"hook": sc["hook"]}, sid)
                run_actions(ctx, sc.get("actions"), sid)
                if sc.get("shot"): frame_on(ctx, sc["shot"], sid)       # what the camera looks at
                elif not sc.get("hold_s"): print(f"  ⚠ {sid}: no `shot` — the camera will stay on the controls")
                framed = time.monotonic() - t0
            except (PWTimeout, RuntimeError, ValueError) as e:
                pw_ctx.close(); browser.close()
                sys.exit(f"✖ scene {sid!r} failed: {str(e).splitlines()[0]}\n"
                         f"  (recording aborted at {start:.0f}s — fix the scene or the testid, then re-run)")
            # hold = max(action time, narration + pad): audio never outruns the picture, screen never idles
            if "hold_s" in sc:
                want = float(sc["hold_s"])
            elif a.no_audio:
                want = max(2.0, len(text.split()) / a.wps) + float(sc.get("pad_s", pad_default))
            else:
                want = float(durations.get(sid, 0)) + float(sc.get("pad_s", pad_default))
            # narration starts when the shot is framed (default) so the voice never describes what is not
            # yet on screen; `narrate: at_start` talks over long actions instead
            speak_at = start if sc.get("narrate", "after_shot") == "at_start" else framed
            now = time.monotonic() - t0
            # hold arithmetic in COMPRESSED time, counted from when the narration starts
            rm = Remap(ctx.fast[n_fast_before:], k, lead, min_s, total=now)
            elapsed_out = rm.compressed_duration(speak_at, now)
            page.wait_for_timeout(int(max(0.0, want - elapsed_out) * 1000))
            end = time.monotonic() - t0
            timeline.append({"id": sid, "start_s": round(start, 3), "speak_at_s": round(speak_at, 3),
                             "end_s": round(end, 3), "narration": text,
                             "fast": [[round(a, 3), round(b, 3)] for a, b in ctx.fast[n_fast_before:]]})
        page.wait_for_timeout(400)
        video = page.video; pw_ctx.close(); browser.close()
        Path(video.path()).replace(raw / "session.webm")
        for f in (raw / "_rec").glob("*"): f.unlink()
        (raw / "_rec").rmdir()

        # subtitle cues as transparent PNGs (fallback when ffmpeg has no libass)
        for f in cues.glob("*.png"): f.unlink()
        fs = int(vp["height"] * 0.026)
        for i, sc in enumerate(timeline):
            if sc["narration"]:
                render_png(p, CUE_HTML.format(w=vp["width"], h=vp["height"], font=a.font, fs=fs,
                                              text=sc["narration"]), vp, cues / f"{i:03d}.png", transparent=True)

        render_png(p, BADGE_HTML.format(w=vp["width"], h=vp["height"], font=a.font, fs=int(vp["height"] * 0.024)),
                   vp, raw / "badge.png", transparent=True)

    meta = {"scenes": timeline, "remap": {"k": k, "lead_s": lead, "min_s": min_s}}
    (out / "scenes.json").write_text(json.dumps(meta, indent=2))
    print(f"✔ {raw / 'session.webm'}  ({timeline[-1]['end_s']:.0f}s, {len(timeline)} scenes) → {out / 'scenes.json'}")


if __name__ == "__main__":
    main()
