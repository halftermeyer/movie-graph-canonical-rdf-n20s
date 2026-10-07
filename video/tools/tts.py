#!/usr/bin/env python3
"""Generate one narration WAV per scene with Gemini TTS, cached by text hash.

Writes video/audio/<scene id>.wav and video/audio/durations.json {id: seconds}.

Usage:
  GEMINI_API_KEY=... tts.py --script demo-script.md [--out video/audio]
                            [--voice Kore] [--model gemini-2.5-flash-preview-tts]
  tts.py --list-models          # find the current TTS model name if the default fails
  tts.py --provider elevenlabs  # needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
Gemini returns RAW 16-bit PCM mono 24 kHz (no container) — we wrap it in a WAV header,
otherwise nothing downstream can measure duration. 503s happen mid-batch: we retry.
"""
import argparse, hashlib, json, os, re, sys, time, wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scenes_parser import load, narration as narr

PCM_RATE, PCM_WIDTH, PCM_CH = 24_000, 2, 1
RETRIES, BACKOFF_S = 4, 3


def wav_from_pcm(pcm: bytes, path: Path, rate=PCM_RATE):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(PCM_CH); w.setsampwidth(PCM_WIDTH); w.setframerate(rate); w.writeframes(pcm)


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def gemini_tts(text, voice, model) -> bytes:
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    resp = client.models.generate_content(
        model=model, contents=text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice)))))
    return resp.candidates[0].content.parts[0].inline_data.data


def elevenlabs_tts(text, voice, model) -> bytes:
    import requests
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID", voice)
    r = requests.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                      params={"output_format": "pcm_24000"},
                      headers={"xi-api-key": os.environ["ELEVENLABS_API_KEY"]},
                      json={"text": text, "model_id": model or "eleven_multilingual_v2"}, timeout=120)
    r.raise_for_status(); return r.content


PROVIDERS = {"gemini": gemini_tts, "elevenlabs": elevenlabs_tts}


def with_retries(fn, *args):
    for attempt in range(1, RETRIES + 1):
        try:
            return fn(*args)
        except Exception as e:
            msg = str(e)
            transient = any(k in msg for k in ("503", "429", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "overloaded", "timed out"))
            if attempt == RETRIES or not transient: raise
            wait = BACKOFF_S * attempt
            print(f"  ⏳ transient TTS error ({msg[:60]}…) — retry {attempt}/{RETRIES - 1} in {wait}s", flush=True)
            time.sleep(wait)


def list_models():
    from google import genai
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    for m in client.models.list():
        if "tts" in m.name.lower(): print(m.name)


NUMBER_RE = re.compile(r"\b(19|20)\d\d('s)?\b|\b\d{4,}\b|\d+\.\d+%?")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", default="demo-script.md")
    ap.add_argument("--out", default="video/audio")
    ap.add_argument("--voice"); ap.add_argument("--model")
    ap.add_argument("--provider", default="gemini", choices=PROVIDERS)
    ap.add_argument("--list-models", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if a.list_models: return list_models()

    cfg = load(a.script)
    voice = a.voice or cfg.get("voice", "Kore")
    model = a.model or cfg.get("tts_model", "gemini-2.5-flash-preview-tts")
    style = cfg.get("tts_style", "")          # optional stage direction prefixed to every scene
    out = Path(a.out); (out / ".cache").mkdir(parents=True, exist_ok=True)
    synth = PROVIDERS[a.provider]

    durations = {}
    for sc in cfg["scenes"]:
        sid, text = sc["id"], narr(sc)
        if not text:
            durations[sid] = float(sc.get("hold_s", 0)); continue
        if NUMBER_RE.search(text):
            print(f"  ⚠ {sid}: contains years/long numbers/decimals — write them as words for the voice")
        spoken = f"{style} {text}".strip() if style else text
        key = hashlib.sha256(f"{a.provider}|{model}|{voice}|{spoken}".encode()).hexdigest()[:20]
        cached = out / ".cache" / f"{key}.wav"
        if cached.exists() and not a.force:
            print(f"= {sid} (cached)")
        else:
            print(f"♪ {sid} ({len(text.split())} words)", flush=True)
            try:
                wav_from_pcm(with_retries(synth, spoken, voice, model), cached)
            except Exception as e:
                sys.exit(f"✖ TTS failed on {sid!r}: {e}\n  Try: tts.py --list-models  and set tts_model in the script config")
        target = out / f"{sid}.wav"; target.write_bytes(cached.read_bytes())
        durations[sid] = round(wav_duration(target), 3)
        if durations[sid] > 25:
            print(f"  ⚠ {sid}: {durations[sid]:.0f}s of narration — consider splitting the scene")

    (out / "durations.json").write_text(json.dumps(durations, indent=2))
    print(f"✔ {len(durations)} scenes, {sum(durations.values()):.0f}s of narration → {out / 'durations.json'}")


if __name__ == "__main__":
    main()
