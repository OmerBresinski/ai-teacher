"""A/B gate metrics (round 9 metrics.py plus the ab dangling check, 7 Oct) from the SHIPPED state: metrics.py <runs dir> [<retry dir>] -> one JSON line.

Everything is read from what a run shipped: the final lesson.json (its slides and elements) and the
rendered slides' DOM measure (geom.json, render.ts). Nothing comes from the harness's summary event
or any pre-repair list (coordinator, 7 Oct). The writer's own output (main.json) is read only for
the writer-side measures named so (look, label strings' labels).
- visualShown: teaching slides (3 on; no question items, options or stem) that show a picture or
  diagram element, over teaching slides; plus visualSlidesShown over all slides from 3.
- textChars: mean characters of text on the shipped slides from 3 (every text element).
- shippedOverflow / shippedOverflowLessons: slides whose rendered DOM has text over its box or off
  the slide (geom.json overflow + offCanvas).
- textOnlyTeach: teaching slides that ship with no picture or diagram.
- labelStrings: shipped texts that join two or more of the writer's figure labels with "; ".
- dangling (ab, 7 Oct): shipped sentences that send pupils to something shown (point to/at, look
  at, label, trace, circle, spot, "this hen", "match each adult", "compare these"...) where the slide
  has no visual, or where no visual on the slide shows every thing the sentence names. What a visual
  shows is read from the shipped element only: alt, the picture judge's evidence.visible, subject
  boxes, and an SVG diagram's text; a judged generated/library pick (no `visible`) adds its request
  (round 6 metric fix, 8 Oct, applied to every arm). "Point to the hen" beside a lone puppy photo is dangling.
  danglingLegacy keeps the round 9 count (POINT regex, any image clears the slide) for comparison;
  danglingList names each hit.
- lookUnmet (writer-side): flow entries whose look names a picture or diagram while the writer's
  slide asks for no visual.
"""
import glob, json, os, re, sys
# --paired-with <baseRunsDir> (cache, 8 Oct): slide-by-slide against the base run whose writer this
# run replayed (ab/CACHE.md); prints one JSON line of per-metric differences instead of the totals.
PAIRED = None
if "--paired-with" in sys.argv:
    k = sys.argv.index("--paired-with"); PAIRED = sys.argv[k + 1]; del sys.argv[k:k + 2]
runs = sorted(d for d in glob.glob(f"{sys.argv[1]}/*") if os.path.isdir(d))
retry = sys.argv[2] if len(sys.argv) > 2 else None
if retry: runs = [f"{retry}/{os.path.basename(r)}" if os.path.exists(f"{retry}/{os.path.basename(r)}") else r for r in runs]
POINT = re.compile(r"\b(look at|looking at|trace the|in the (picture|diagram|graph|map|photo|table)|the (diagram|graph|map|picture|photo|chart|figure) (shows|below|above)|shown (here|below|above)|use the (diagram|graph|map|picture|table|chart))\b", re.I)
# ---- ab dangling (7 Oct) ----
import urllib.parse, html
STRONG = re.compile(r"\b(point (to|at|and)|point out|look (at|closely|carefully)|looking at|trace (the|this|these|each)|label (the|this|these|each|it|them)|circle (the|this|these|each)|spot (the|this|these)|find (the|this|these) \w+ (in|on) the|(in|on|from) (the|this) (picture|photo|photograph|diagram|graph|map|image|drawing|table|chart|timeline)s?|(the|this) (diagram|graph|map|picture|photo|chart|figure|image) (shows|below|above)|shown (here|below|above)|use the (picture|photo|diagram|graph|map|table|chart|image)s?|can you see|what do you notice|which (picture|photo|one|animal|shape)s?\b)", re.I)
WEAK = re.compile(r"\b(match|compare|name|sort|count|label)\b(\s+\w+){0,2}?\s+(each|every|both|this|these|those|that)\b", re.I)
DEICTIC = re.compile(r"\b(this|these|those)\s+((?:[a-z]+\s+){0,3}?)([a-z]+)\b(?=\s+(is|are|was|were|has|have|shows?|looks?|will|can|grows?|in|on|at|from)\b|[.?!,]|$)", re.I)
ABSTRACT = set("lesson lessons week time term question questions word words sentence sentences idea ideas way rule rules step steps method sum sums number numbers one ones process change changes model theory topic text passage poem extract quote quotation answer answers task point points case example examples fact facts reason reasons phrase phrases example examples result results estimate estimates date dates interval test comparison claim threat average finding findings evidence study experiment argument view distinction assumption".split())
PRONOUN_NEXT = set("is are was were has have had could would might may can will should does do did not alone a an the means mean shows show suggests suggest supports support challenges challenge happen happens tells tell different same fair true right wrong important".split())
STOP = set("""a an the to at of and or in on is are it its it's their his her them they this these that those each every both with for from as by be into out up how what which who why do does did can will would should could
point look looking trace label circle spot find name match compare sort count describe say tell show shown here below above closely carefully see notice you your our we us one ones next first then now
picture pictures photo photos photograph photographs diagram diagrams graph graphs map maps image images drawing drawings table tables chart charts figure figures timeline
young adult adults small smaller big bigger large larger little baby female male grown fully partly different same other another two three four still growing""".split())
ALIAS = {"hen": ["chicken"], "chick": ["chicken"], "chicks": ["chicken"], "pullet": ["chicken", "hen"], "rooster": ["chicken"], "cockerel": ["chicken"], "calf": ["cattle"], "cow": ["cattle"], "lamb": ["sheep"]}
def forms(w):
    w = w.lower(); f = {w}
    if w.endswith("ies") and len(w) > 4: f.add(w[:-3] + "y")
    if w.endswith("es") and len(w) > 4: f.add(w[:-2])
    if w.endswith("s") and len(w) > 3: f.add(w[:-1])
    if w.endswith("y") and len(w) > 4: f.add(w[:-1])  # round 6 metric fix: "fluffy" = "fluff"
    return f
def stem(w): return min(forms(w), key=len)
def shows_bag(sl):
    bag = set()
    for e in sl.get("elements", []):
        if e.get("type") != "image" or not e.get("src"): continue
        parts = [e.get("alt") or ""]
        src = (e.get("source") or {}); ev = src.get("evidence") or {}
        parts += [str(x) for x in ev.get("visible") or []]
        # Round 6 metric fix (rootcause/pictures.md C, every arm): a generated or library pick passed the
        # picture judge against its brief but carries no `visible`; the request it was judged on counts.
        if not ev.get("visible") and src.get("provider") not in ("pexels", "commons"):
            parts.append(e.get("request") or "")
        parts += [str(x.get("name")) for x in e.get("subjects") or [] if isinstance(x, dict)]
        if str(e["src"]).startswith("data:image/svg"):
            svg = urllib.parse.unquote(e["src"])
            parts += re.findall(r'aria-label="([^"]*)"', svg) + re.findall(r">([^<>]+)<", svg)
        for w in re.findall(r"[a-zA-Z]+", html.unescape(" ".join(parts))):
            bag |= forms(w); bag.update(ALIAS.get(w.lower(), []))
    return bag
def named(phrase):
    return [w for w in re.findall(r"[a-zA-Z]+", phrase) if len(w) > 2 and w.lower() not in STOP]
def dangling_hits(sl):
    """[(sentence, reason)] for one shipped slide."""
    has = any(e.get("type") == "image" and e.get("src") for e in sl.get("elements", []))
    bag = shows_bag(sl) if has else set()
    out = []
    for t in slide_text(sl):
        for sent in re.split(r"(?<=[.?!])\s+", t):
            m = STRONG.search(sent) or WEAK.search(sent); obj = None
            if m:
                obj = re.split(r"[,;:.?!]| and (?:say|name|tell|explain|write|describe|talk)\b| to its\b", sent[m.end():])[0]
                obj = re.split(r"\b(that|which|who|where|by|then|into|with|from)\b", obj)[0]
            else:
                d = DEICTIC.search(sent)
                first = (d.group(2).split() or [d.group(3)])[0].lower() if d else ""
                if d and first not in PRONOUN_NEXT and not (d.group(1).lower() == "this" and first.endswith("s") and not first.endswith("ss")) \
                        and not (set().union(*(forms(w) for w in (d.group(2) + d.group(3)).split())) & ABSTRACT):
                    m, obj = d, d.group(2) + d.group(3)
            if not m: continue
            if not has: out.append((sent, f'"{m.group(0)}" with no visual on the slide')); continue
            if any(str(e.get("src", "")).startswith("data:image/svg") for e in sl.get("elements", []) if e.get("type") == "image"): continue  # a drawn diagram: presence only
            miss = [w for w in named(obj or "") if not (forms(w) & bag)]
            if miss: out.append((sent, f'"{m.group(0)}" names {", ".join(miss)}; no visual on the slide shows it'))
    return out
LIST = []
QUESTION = {"Item", "Option", "Option text", "Stem"}
def texts(o):
    if isinstance(o, dict):
        if o.get("type") == "text" and isinstance(o.get("text"), str): yield o["text"]
        for v in o.values(): yield from texts(v)
    elif isinstance(o, list):
        for v in o: yield from texts(v)
def slide_text(sl): return [t for e in sl.get("elements", []) if e.get("type") == "text" for t in ["".join(texts(e.get("doc", {})))]]
def writer(r):
    try: return json.loads(json.load(open(f"{r}/main.json"))["text"])
    except Exception:
        try: return json.loads(open(f"{r}/stream.txt").read())
        except Exception: return {}
def asks_visual(s):
    if any(isinstance(s.get(k), dict) for k in ("figure", "picture", "diagram")): return True
    return any(isinstance(c, dict) and isinstance(c.get("picture"), dict) for c in (s.get("columns") or [])) or bool(s.get("sequence"))
def slide_measures(r):
    """Per slide (from 3): the shipped measures this script totals, keyed by slide number."""
    try: lesson = json.load(open(f"{r}/lesson.json"))
    except Exception: return None
    w = writer(r); ws = w.get("slides") or []; out = {}
    try:
        g = json.load(open(f"{r}/geom.json"))["summary"]; bad = set(g.get("overflow", [])) | set(g.get("offCanvas", []))
    except Exception: bad = None
    for i, sl in enumerate(lesson.get("slides", [])):
        if i < 2: continue
        names = {e.get("name") for e in sl.get("elements", [])}
        shown = any(e.get("type") == "image" for e in sl.get("elements", []))
        tx = slide_text(sl); labs = set(); k = i - 2
        if k < len(ws):
            for f in ("figure", "picture", "diagram"):
                if isinstance(ws[k].get(f), dict): labs |= {str(x).strip().lower() for x in ws[k][f].get("labels") or [] if str(x).strip()}
        m = dict(textChars=sum(len(t) for t in tx), visualShown=int(shown), textOnlyTeach=int(not shown and not (names & QUESTION)),
                 dangling=len(list(dangling_hits(sl))), danglingLegacy=0 if shown else sum(1 for t in tx for p in re.split(r"(?<=[.?!])\s+", t) if POINT.search(p)),
                 labelStrings=sum(1 for t in tx if len([p for p in t.split(";") if p.strip().lower() in labs]) >= 2 and len(labs) >= 2),
                 elements=len(sl.get("elements", [])), images=sum(1 for e in sl.get("elements", []) if e.get("type") == "image"))
        if bad is not None: m["shippedOverflow"] = int(any(str(i + 1) == str(b) or b == i + 1 for b in bad))
        m["_sig"] = json.dumps([{kk: vv for kk, vv in e.items() if kk not in ("id", "source") and not (kk == "style" and isinstance(vv, str))} for e in sl.get("elements", [])], sort_keys=True)
        out[i + 1] = m
    return out
if PAIRED:
    import hashlib
    def wsig(r):
        for f in ("stream.txt", "main.json"):
            if os.path.exists(f"{r}/{f}"): return hashlib.sha256(open(f"{r}/{f}", "rb").read()).hexdigest()
    base = {os.path.basename(d): d for d in glob.glob(f"{PAIRED}/*") if os.path.isdir(d)}
    P = dict(lessons=0, writerSame=0, slides=0, slidesChanged=0); D = {}; CH = []
    for r in runs:
        b = base.get(os.path.basename(r)); A = slide_measures(r); Bm = slide_measures(b) if b else None
        if A is None or Bm is None: continue
        P["lessons"] += 1; same = wsig(r) == wsig(b); P["writerSame"] += same
        for n in sorted(set(A) | set(Bm)):
            a, bb = A.get(n, {}), Bm.get(n, {}); P["slides"] += 1
            P["slidesChanged"] += a.get("_sig") != bb.get("_sig")
            for key in sorted((set(a) | set(bb)) - {"_sig"}):
                d = a.get(key, 0) - bb.get(key, 0)
                if d: D[key] = D.get(key, 0) + d; CH.append(dict(lesson=os.path.basename(r), slide=n, metric=key, base=bb.get(key), arm=a.get(key)))
    print(json.dumps(dict(P, note="writer identical in writerSame of lessons: differences there are code-only", delta=D, changes=CH)))
    sys.exit(0)
M = dict(lessons=0, slides=0, teach=0, visualShownTeach=0, visualSlidesShown=0, textChars=0, shippedOverflow=0,
         shippedOverflowLessons=0, textOnlyTeach=0, labelStrings=0, dangling=0, danglingLegacy=0, lookUnmet=0, lookVisual=0, missingGeom=0)
for r in runs:
    try: lesson = json.load(open(f"{r}/lesson.json"))
    except Exception: continue
    M["lessons"] += 1
    slides = lesson.get("slides", [])
    w = writer(r); ws = w.get("slides") or []
    for i, sl in enumerate(slides):
        if i < 2: continue
        names = {e.get("name") for e in sl.get("elements", [])}
        shown = any(e.get("type") == "image" for e in sl.get("elements", []))
        teach = not (names & QUESTION)
        tx = slide_text(sl)
        M["slides"] += 1; M["textChars"] += sum(len(t) for t in tx); M["visualSlidesShown"] += shown
        if teach:
            M["teach"] += 1; M["visualShownTeach"] += shown; M["textOnlyTeach"] += not shown
        if not shown: M["danglingLegacy"] += sum(1 for t in tx for p in re.split(r"(?<=[.?!])\s+", t) if POINT.search(p))
        for sent, why in dangling_hits(sl):
            M["dangling"] += 1; LIST.append(dict(lesson=os.path.relpath(r, sys.argv[1]), slide=i + 1, text=sent[:120], why=why))
        k = i - 2
        if k < len(ws):
            labs = set()
            for f in ("figure", "picture", "diagram"):
                if isinstance(ws[k].get(f), dict): labs |= {str(x).strip().lower() for x in ws[k][f].get("labels") or [] if str(x).strip()}
            if len(labs) >= 2:
                for t in tx:
                    parts = [p.strip().lower() for p in t.split(";")]
                    if len(parts) >= 2 and sum(p in labs for p in parts) >= 2: M["labelStrings"] += 1
    for f in w.get("flow") or []:
        look = f.get("look") if isinstance(f.get("look"), dict) else None
        k = (f.get("slide") or 0) - 3
        if look and look.get("kind") in ("picture", "picture-sequence", "diagram") and 0 <= k < len(ws):
            M["lookVisual"] += 1; M["lookUnmet"] += not asks_visual(ws[k])
    try:
        g = json.load(open(f"{r}/geom.json"))["summary"]
        bad = set(g.get("overflow", [])) | set(g.get("offCanvas", []))
        M["shippedOverflow"] += len(bad); M["shippedOverflowLessons"] += bool(bad)
    except Exception: M["missingGeom"] += 1
out = dict(M, visualShown=round(M["visualShownTeach"] / max(1, M["teach"]), 3), visualShare=round(M["visualSlidesShown"] / max(1, M["slides"]), 3),
           textChars=round(M["textChars"] / max(1, M["slides"]), 1), danglingList=LIST)
print(json.dumps(out))
