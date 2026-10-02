#!/usr/bin/env python3
"""Build a blind visual judge packet for one brief: two decks as X and Y image sequences.

Usage: python3 harness/build-packet.py <packetId> <oursDir> <chalkieDir> [--seed=N]
  oursDir    render.ts output for one lesson (slide-NN.png)
  chalkieDir chalkie-convert.py output (slide-NN.png; answer pages already dropped)
Writes packets/<packetId>/{X,Y}/slide-NN.png, X-sheet.png, Y-sheet.png, pass-1.md (Deck 1 = X,
Deck 2 = Y) and pass-2.md (Deck 1 = Y, Deck 2 = X). The key (which of X/Y is ours) goes to
packets/_keys/<packetId>.json, outside the packet: never give it to a judge.
Branding: Chalkie's wordmark (teal, or white on dark grounds) is found by template match at its
fixed spot (top-right on title slides, bottom-right otherwise; masks in harness/marks/) and only the
rows it shows on are repainted, by interpolating the local ground either side of it. The DayBack presenter shows no mark (render.ts also
hides the control bar), so our slides are copied as rendered.
"""
import glob, json, os, random, shutil, subprocess, sys
from collections import Counter
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
args = [a for a in sys.argv[1:] if not a.startswith("--seed")]
seed = next((int(a.split("=")[1]) for a in sys.argv[1:] if a.startswith("--seed=")), None)
pid, ours, chalkie = args[0], os.path.abspath(args[1]), os.path.abspath(args[2])

MARKS = f"{HERE}/marks"  # template masks of the wordmark, cut from clean Chalkie slides
BOXES = {"T": (1204, 52), "B": (1268, 746)}  # template origin per corner (title slides top, others bottom)

def teal(p):
    r, g, b = p[:3]
    return abs(r - 65) < 45 and abs(g - 157) < 40 and abs(b - 158) < 40 and g - r > 50

def white(p):
    return min(p[:3]) > 200

TEMPLATES = []
for name in ("T-teal", "B-teal", "T-white", "B-white"):
    mi = Image.open(f"{MARKS}/{name}.png")
    pts = [(x, y) for y in range(mi.height) for x in range(mi.width) if mi.getpixel((x, y)) > 0]
    TEMPLATES.append((name, BOXES[name[0]], mi.size, set(pts), teal if name.endswith("teal") else white))

def lum(p):
    return 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]

def strip_chalkie(im):
    """Find the wordmark by template match at its fixed spot and repaint only the rows it shows on.

    Each candidate (corner x colour, +/-3 px shift) is scored by recall (share of template pixels
    that are mark-coloured here) and precision (share of mark-coloured pixels in the box that fall
    on the template). Teal title text near the top-right fails precision, so it is left alone. A
    mark half hidden behind a photo still matches on its visible part (recall >= 0.08). Repaint:
    per row, only the column span holding mark pixels (+3 px), filled by linear interpolation
    between the pixels just outside that span, so gradients and shape edges carry through; when
    one side sample is foreign (a photo edge), the side matching the box border majority is used.
    """
    im = im.convert("RGB")
    if im.width != 1440:
        im = im.resize((1440, round(im.height * 1440 / im.width)))
    px = im.load()
    W, H = im.size
    best = None
    for name, (ox, oy), (tw, th), pts, fn in TEMPLATES:
        if fn is white:  # a white mark only sits on a dark ground
            border = [px[min(ox + x, W - 1), min(oy + y, H - 1)] for x in range(0, tw, 4) for y in (0, th - 1)]
            if sum(lum(p) for p in border) / len(border) > 110:
                continue
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                hits = set()
                for y in range(th):
                    for x in range(tw):
                        X, Y = ox + dx + x, oy + dy + y
                        if X < W and Y < H and fn(px[X, Y]):
                            hits.add((x, y))
                if not hits:
                    continue
                inter = len(hits & pts)
                rec, prec = inter / len(pts), inter / len(hits)
                if rec >= 0.08 and prec >= 0.7 and (best is None or rec > best[0]):
                    best = (rec, prec, name, ox + dx, oy + dy, tw, th, fn)
    if not best:
        return im, 0, None
    rec, prec, name, ox, oy, tw, th, fn = best
    pts = next(t[3] for t in TEMPLATES if t[0] == name)
    ring = [px[min(ox + x, W - 1), min(oy + y, H - 1)] for x in range(tw) for y in (0, th - 1)]
    ring += [px[min(ox + x, W - 1), min(oy + y, H - 1)] for y in range(th) for x in (0, tw - 1)]
    ground = Counter(ring).most_common(1)[0][0]
    dist = lambda p, q: sum(abs(p[i] - q[i]) for i in range(3))
    D = 5 if fn is teal else 3  # the teal mark wears a white outline; the white one a dark one
    xs0 = [x for x, _ in pts]; ys0 = [y for _, y in pts]
    rx0, rx1 = max(ox + min(xs0) - D, 0), min(ox + max(xs0) + D, W - 2)
    ry0, ry1 = max(oy + min(ys0) - D, 0), min(oy + max(ys0) + D, H - 1)
    near = {(ox + x + ddx, oy + y + ddy) for (x, y) in pts for ddx in range(-D, D + 1) for ddy in range(-D, D + 1)}
    def foreign(p):  # neither ground nor wordmark ink or outline: a photo or card over the mark
        return dist(p, ground) > 60 and not teal(p) and min(p) <= 200 and max(p) >= 70
    painted = 0
    if rec >= 0.9:  # the whole mark shows: fill its exact rectangle, row by row, from the ground either side
        for Y in range(ry0, ry1 + 1):
            L, R = px[max(rx0 - 1, 0), Y], px[rx1 + 1, Y]
            L = None if foreign(L) else L
            R = None if foreign(R) else R
            L, R = L or R or ground, R or L or ground
            for X in range(rx0, rx1 + 1):
                t = (X - rx0 + 1) / (rx1 - rx0 + 2)
                px[X, Y] = tuple(round(L[i] + (R[i] - L[i]) * t) for i in range(3))
            painted += 1
        return im, 1, (name, round(rec, 2), round(prec, 2), ox, oy, painted)
    # Part of the mark hides behind a photo or card, which comes in from the top-left of the mark's
    # rectangle. Find the card as a box: rows from the top that are mostly card, then columns from
    # the left that are mostly card within those rows. Everything else in the rectangle (the visible
    # glyph, its outline, ground) takes the ground colour found just right of the rectangle.
    side = [px[min(X, W - 1), Y] for Y in range(ry0, ry1 + 1) for X in (rx1 + 2, rx1 + 4)]
    ground = Counter(side).most_common(1)[0][0]
    def other(p):  # not ground, not the teal ink, not its near-white outline
        return dist(p, ground) > 40 and not teal(p) and dist(p, (255, 255, 255)) > 30
    cw = rx1 - rx0 + 1
    cb = ry0 - 1
    while cb + 1 <= ry1 and sum(other(px[X, cb + 1]) for X in range(rx0, rx1 + 1)) >= 0.5 * cw:
        cb += 1
    cr = rx0 - 1
    if cb >= ry0:
        while cr + 1 <= rx1 and sum(other(px[cr + 1, Y]) for Y in range(ry0, cb + 1)) >= 0.5 * (cb - ry0 + 1):
            cr += 1
    for Y in range(ry0, ry1 + 1):
        for X in range(rx0, rx1 + 1):
            p = px[X, Y]
            inkish = p[1] - p[0] > 35 and p[2] - p[0] > 35 and abs(p[1] - p[2]) < 40  # teal and its blends
            if not (X <= cr and Y <= cb) or inkish or not other(p):
                px[X, Y] = ground
        painted += 1
    return im, 1, (name, round(rec, 2), round(prec, 2), ox, oy, painted)

rng = random.Random(seed)
ours_is = rng.choice(["X", "Y"])
out = f"{ROOT}/packets/{pid}"
shutil.rmtree(out, ignore_errors=True)
decks = {ours_is: ("ours", ours), ("Y" if ours_is == "X" else "X"): ("chalkie", chalkie)}
counts = {}
for label, (src, d) in decks.items():
    os.makedirs(f"{out}/{label}")
    files = sorted(glob.glob(f"{d}/slide-*.png"))
    counts[label] = len(files)
    marks = 0
    for i, f in enumerate(files, 1):
        im = Image.open(f).convert("RGB")
        if src == "chalkie":
            im, c, info = strip_chalkie(im)
            marks += c
            if os.environ.get("MARK_LOG"):
                print(f"  {os.path.basename(f)}: {info}")
        if im.width != 1440:
            im = im.resize((1440, round(im.height * 1440 / im.width)))
        im.save(f"{out}/{label}/slide-{i:02d}.png")
    subprocess.run([sys.executable, f"{HERE}/sheet.py", f"{out}/{label}-sheet.png", "3", *sorted(glob.glob(f"{out}/{label}/slide-*.png"))], check=True)
    if src == "chalkie":
        print(f"chalkie wordmarks covered: {marks} on {len(files)} slides")
os.makedirs(f"{ROOT}/packets/_keys", exist_ok=True)
json.dump({"packet": pid, "ours": ours_is, "chalkie": "Y" if ours_is == "X" else "X", "oursDir": ours, "chalkieDir": chalkie, "seed": seed},
          open(f"{ROOT}/packets/_keys/{pid}.json", "w"), indent=1)
brief = open(f"{ROOT}/briefs/{pid}.json").read() if os.path.exists(f"{ROOT}/briefs/{pid}.json") else "{}"
b = json.loads(brief).get("brief", {}); j = json.loads(brief)
line = f"{j.get('yearGroup', '?')}, {j.get('subject', '?')}: {b.get('topic', pid)}, a {b.get('durationMin', 60)}-minute lesson"
for n, (one, two) in enumerate([("X", "Y"), ("Y", "X")], 1):
    with open(f"{out}/pass-{n}.md", "w") as fh:
        fh.write(f"# Visual judging, packet {pid}, pass {n}\n\nRead `{ROOT}/VISUAL-JUDGE.md` and follow it.\n\n"
                 f"Brief: {line}.\n\n"
                 f"- Deck 1: {counts[one]} slides, `{out}/{one}/slide-01.png` to `slide-{counts[one]:02d}.png` (overview: `{out}/{one}-sheet.png`)\n"
                 f"- Deck 2: {counts[two]} slides, `{out}/{two}/slide-01.png` to `slide-{counts[two]:02d}.png` (overview: `{out}/{two}-sheet.png`)\n\n"
                 f"Write your JSON to `{ROOT}/judgments/{pid}-pass-{n}.json` with \"pass\": {n}, \"deck1\": \"{one}\", \"deck2\": \"{two}\".\n")
print(f"packet {out}: X {counts['X']} slides, Y {counts['Y']} slides; key packets/_keys/{pid}.json")
