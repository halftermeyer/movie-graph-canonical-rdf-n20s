#!/usr/bin/env python3
"""Spot-check frames: one PNG per scene at its start and its middle, plus a contact sheet.

The pipeline's real deliverable is a cheap review loop. `frames.py` turns "the graph isn't
visible in Explore" into a picture in seconds, without scrubbing the video.

Usage: frames.py [--dist dist] [--out dist/frames]
"""
import argparse, json, subprocess, sys
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", default="dist"); ap.add_argument("--out", default="dist/frames")
    a = ap.parse_args()
    dist, out = Path(a.dist), Path(a.out); out.mkdir(parents=True, exist_ok=True)
    idx = json.loads((dist / "scene_index.json").read_text())
    video = dist / "demo.mp4"
    shots = []
    for sc in idx:
        spk = sc.get("speak_at_s", sc["start_s"])
        for tag, t in (("speak", spk + 0.3), ("mid", (spk + sc["end_s"]) / 2)):
            png = out / f"{sc['id']}__{tag}.png"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1",
                            "-vf", "scale=640:-1", png], check=True)
            shots.append(png)
    # contact sheet with ffmpeg tile (2 per scene → 2 columns)
    rows = max(1, len(shots) // 2)
    lst = out / "_list.txt"; lst.write_text("".join(f"file '{p.resolve()}'\n" for p in shots))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                    "-vf", f"tile=2x{rows}:padding=6:margin=6", "-frames:v", "1", out / "contact_sheet.png"], check=True)
    lst.unlink()
    print(f"✔ {len(shots)} frames → {out}  (contact_sheet.png: left = narration start, right = scene middle)")


if __name__ == "__main__":
    main()
