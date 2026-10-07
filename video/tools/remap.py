"""Time remapping shared by record.py and assemble.py — the ONE function both must use.

A recording is taken in real time; boring intervals (spinners, LLM latency) are marked by
fast_begin/fast_end in the scenes and compressed at assembly. Every timestamp that crosses
the cut — scene starts, narration delays, subtitle windows, SRT — goes through `Remap`.
If two components implemented this separately, audio would drift from the first cut on.

Rules (from review of the first watchable cut):
- keep LEAD_S of real time before compressing so the audience reads what was just asked
- windows shorter than MIN_S are left alone (a whoosh needs something to whoosh past)
- compression factor K applies to the remainder of the window
"""
from dataclasses import dataclass

K, LEAD_S, MIN_S = 8.0, 1.5, 3.0


@dataclass
class Segment:
    start: float   # real time
    end: float
    speed: float   # 1.0 or K


class Remap:
    def __init__(self, windows, k=K, lead=LEAD_S, min_s=MIN_S, total=None):
        self.segments = []
        cursor = 0.0
        for a, b in sorted(windows):
            if b - a < min_s:
                continue
            a2 = a + lead                                   # keep the lead in real time
            if a2 > cursor: self.segments.append(Segment(cursor, a2, 1.0))
            self.segments.append(Segment(a2, b, k)); cursor = b
        if total is not None and total > cursor:
            self.segments.append(Segment(cursor, total, 1.0))
        self._total = total

    def __call__(self, t: float) -> float:
        """real time → output time"""
        out = 0.0
        for s in self.segments:
            if t <= s.start: break
            span = min(t, s.end) - s.start
            out += span / s.speed
            if t <= s.end: return out
        # beyond the last segment: pass through at 1x
        last_end = self.segments[-1].end if self.segments else 0.0
        return out + max(0.0, t - last_end)

    def fast_windows_out(self):
        """compressed windows in OUTPUT time, for the ⏩ badge overlay"""
        return [(self(s.start), self(s.end)) for s in self.segments if s.speed != 1.0]

    def compressed_duration(self, a: float, b: float) -> float:
        return self(b) - self(a)
