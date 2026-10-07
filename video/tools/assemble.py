#!/usr/bin/env python3
"""Assemble dist/demo.mp4 from video/raw/session.webm + video/scenes.json + video/audio/*.wav.

Re-runnable without re-recording. Steps:
  1. transcode the take once (VP8 webm at whatever fps → h264 30 fps yuv420p)
  2. time-remap: compress the fast_begin/fast_end windows (trim + setpts/k + concat) and
     overlay the ⏩ badge on them; EVERY timestamp afterwards goes through the same Remap
  3. title card = video/raw/title.png looped, concatenated (+3 s offset)
  4. audio: each scene WAV adelay'd to remap(start) + offset, amix normalize=0
  5. subtitles: SRT sidecar (remapped); burned with libass if present, else cue PNG overlays

Usage: assemble.py [--video video] [--dist dist] [--no-audio] [--no-title] [--no-fast]
                   [--subs auto|libass|png|none] [--title-s 3]
"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from remap import Remap


def run(cmd):
    print("$", " ".join(str(c) for c in cmd)[:200], flush=True)
    r = subprocess.run([str(c) for c in cmd], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if r.returncode: sys.exit(f"✖ ffmpeg failed:\n{r.stderr[-1500:]}")


def probe(path, entries):
    return subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", path],
                          capture_output=True, text=True).stdout.strip()


def has_filter(name):
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return any(line.split()[1:2] == [name] for line in out.splitlines() if line.strip())


def srt_time(s):
    h, rem = divmod(max(s, 0), 3600); m, sec = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{int(sec):02d},{int(round((sec % 1) * 1000)):03d}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", default="video"); ap.add_argument("--dist", default="dist")
    ap.add_argument("--no-audio", action="store_true"); ap.add_argument("--no-title", action="store_true")
    ap.add_argument("--no-fast", action="store_true", help="keep real time, ignore fast windows")
    ap.add_argument("--subs", default="auto", choices=["auto", "libass", "png", "none"])
    ap.add_argument("--title-s", type=float, default=3.0)
    a = ap.parse_args()
    if not shutil.which("ffmpeg"): sys.exit("✖ ffmpeg not found")

    vid, dist = Path(a.video), Path(a.dist); dist.mkdir(exist_ok=True)
    raw, tmp = vid / "raw", dist / "_tmp"; tmp.mkdir(exist_ok=True)
    meta = json.loads((vid / "scenes.json").read_text())
    timeline = meta["scenes"] if isinstance(meta, dict) else meta
    rcfg = meta.get("remap", {}) if isinstance(meta, dict) else {}
    take_src = raw / "session.webm"
    if not take_src.exists(): sys.exit(f"✖ {take_src} missing — run record.py first")

    # 1. transcode once
    take = tmp / "take.mp4"
    W, H = (int(x) for x in probe(take_src, "stream=width,height").split(",")[:2])
    run(["ffmpeg", "-y", "-i", take_src, "-r", "30", "-vf", f"scale={W}:{H}", "-c:v", "libx264",
         "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-an", take])
    total = float(probe(take, "format=duration"))

    # 2. time remap — the one function every later timestamp goes through
    windows = [] if a.no_fast else [tuple(w) for sc in timeline for w in sc.get("fast", [])]
    rm = Remap(windows, rcfg.get("k", 8.0), rcfg.get("lead_s", 1.5), rcfg.get("min_s", 3.0), total=total)
    body = take
    if any(s.speed != 1.0 for s in rm.segments):
        parts, labels = [], []
        for i, s in enumerate(rm.segments):
            parts.append(f"[0:v]trim=start={s.start:.3f}:end={s.end:.3f},setpts=(PTS-STARTPTS)/{s.speed}[s{i}]")
            labels.append(f"[s{i}]")
        fc = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(labels)}:v=1:a=0[cat]"
        badge = raw / "badge.png"
        if badge.exists() and rm.fast_windows_out():
            enable = "+".join(f"between(t,{x:.3f},{y:.3f})" for x, y in rm.fast_windows_out())
            fc += f";[cat][1:v]overlay=0:0:enable='{enable}'[vout]"
            inputs = ["-i", take, "-i", badge]
        else:
            fc += ";[cat]null[vout]"; inputs = ["-i", take]
        body = tmp / "remapped.mp4"
        run(["ffmpeg", "-y", *inputs, "-filter_complex", fc, "-map", "[vout]", "-r", "30",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", body])
        saved = total - rm(total)
        print(f"⏩ compressed {len(rm.fast_windows_out())} window(s): {total:.0f}s → {rm(total):.0f}s (−{saved:.0f}s)")

    # 3. title card
    offset = 0.0
    if not a.no_title and (raw / "title.png").exists():
        card = tmp / "title.mp4"
        run(["ffmpeg", "-y", "-loop", "1", "-t", str(a.title_s), "-i", raw / "title.png", "-r", "30",
             "-vf", f"scale={W}:{H}", "-c:v", "libx264", "-pix_fmt", "yuv420p", card])
        lst = tmp / "concat.txt"; lst.write_text(f"file '{card.resolve()}'\nfile '{Path(body).resolve()}'\n")
        merged = tmp / "body.mp4"
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", merged]); body = merged
        offset = a.title_s

    out_t = lambda t: offset + rm(t)          # real → final output time

    # 4. audio
    with_audio = body
    if not a.no_audio:
        inputs, delays, labels = [], [], []
        for sc in timeline:
            w = vid / "audio" / f"{sc['id']}.wav"
            if not w.exists(): continue
            inputs += ["-i", w]; k = len(inputs) // 2
            ms = int(out_t(sc.get("speak_at_s", sc["start_s"])) * 1000)
            delays.append(f"[{k}:a]adelay={ms}|{ms}[a{k}]"); labels.append(f"[a{k}]")
        if inputs:
            fc = ";".join(delays) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0[mix]"
            with_audio = tmp / "with_audio.mp4"
            run(["ffmpeg", "-y", "-i", body, *inputs, "-filter_complex", fc, "-map", "0:v", "-map", "[mix]",
                 "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", with_audio])

    # 5. subtitles (remapped windows)
    spoken = [sc for sc in timeline if sc["narration"]]
    srt = dist / "demo.srt"
    srt.write_text("\n".join(f"{i + 1}\n{srt_time(out_t(sc.get('speak_at_s', sc['start_s'])))} --> {srt_time(out_t(sc['end_s']) - 0.05)}\n{sc['narration']}\n"
                             for i, sc in enumerate(spoken)), encoding="utf-8")
    final = dist / "demo.mp4"
    mode = a.subs if a.subs != "auto" else ("libass" if has_filter("subtitles") else "png")
    if mode == "png" and a.subs == "auto": print("ℹ ffmpeg has no libass → overlaying browser-rendered cue PNGs")
    if mode == "none":
        shutil.copy(with_audio, final)
    elif mode == "libass":
        style = "FontSize=15,BorderStyle=3,Outline=3,Shadow=0,BackColour=&H90000000,MarginV=36,PrimaryColour=&H00FFFFFF"
        run(["ffmpeg", "-y", "-i", with_audio, "-vf", f"subtitles={srt}:force_style='{style}'",
             "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", final])
    else:
        cues = sorted((raw / "cues").glob("*.png"))
        if len(cues) != len(spoken): sys.exit("✖ cue PNG count ≠ narrated scenes — re-run record.py")
        inputs, chain, prev = [], [], "[0:v]"
        for i, (png, sc) in enumerate(zip(cues, spoken)):
            inputs += ["-i", png]
            x, y = out_t(sc.get("speak_at_s", sc["start_s"])), out_t(sc["end_s"]) - 0.05
            nxt = f"[v{i}]" if i < len(cues) - 1 else "[vout]"
            chain.append(f"{prev}[{i + 1}:v]overlay=0:0:enable='between(t,{x:.3f},{y:.3f})'{nxt}"); prev = nxt
        run(["ffmpeg", "-y", "-i", with_audio, *inputs, "-filter_complex", ";".join(chain), "-map", "[vout]",
             "-map", "0:a?", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", final])

    # scene index in output time, for frames.py and for the reviewer
    (dist / "scene_index.json").write_text(json.dumps(
        [{"id": sc["id"], "start_s": round(out_t(sc["start_s"]), 2), "speak_at_s": round(out_t(sc.get("speak_at_s", sc["start_s"])), 2),
          "end_s": round(out_t(sc["end_s"]), 2)} for sc in timeline], indent=2))
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"✔ {final}  (+ {srt}, {dist / 'scene_index.json'})")


if __name__ == "__main__":
    main()
