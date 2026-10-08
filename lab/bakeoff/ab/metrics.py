"""A/B gate metrics v2 (8 Oct, checking audit F1-F11) from the SHIPPED state: metrics.py <runs dir> [<retry dir>] -> one JSON line.

Canonical copy (lab/bakeoff/ab/metrics.py); BAKEOFF/ab/metrics.py only forwards here.
Everything is read from what a run shipped: the final lesson.json and the rendered slides' DOM
measure (geom.json). The writer's output (main.json) is read for the plan's templates and the
figure labels it asked for; the picture judge's verdicts come from pictures.log.jsonl.
- teach: slides from 3 whose planned template teaches. This is harness.ts's own rule (repair.ts
  `teaching`: not title, objectives, hinge, question-set, practice, exit-ticket, discussion), the one
  whose checks.json text-only list the audit found exact. An element named Item, Option or Stem no
  longer drops a slide (audit F5). checks.json's textOnlySlides is used when the run has it.
- visualShown: teaching slides that ship a picture or diagram, over teaching slides.
  textOnly = 1 - visualShown on the same slides; it is reported once, as textOnlyShare, and is
  never a second gate (audit F4). Its band is 1 minus the visuals band.
- dangling: SLIDES (not sentences) whose text sends pupils to something the slide does not show:
  * a pointing cue (point to, look at, label the, name both, match each, say each...) on a slide with
    no visual, unless its object is abstract ("name each transfer process") or pupils make the thing
    themselves ("Sketch... Label the axes", "on your worksheet") (F3);
  * "this/these <noun>" with no visual, only as a noun phrase right before a verb or the end of the
    clause: never a pronoun ("Why might this help?", "weigh this against") and never across a verb
    ("this pattern prove that...") (F1);
  * on a slide with a picture, a named subject the picture does not show. Category words (animals,
    bird, parts, changes) and verbs (comes, grows) are not subjects (F2); a category ("Say each
    animal's name") is checked through the slide's own list (cow . sheep / hen . dog);
  * what a picture shows is its alt, the judge's `visible`, its subjects and an SVG's text. A pick
    with no `visible` adds the picture judge's accepted verdict (pictures.log.jsonl `made.fits`),
    never its request. A generated picture that "the pictures" point at must show the request's
    subjects in that verdict ("three adult hens" for hen, chick, chicken fails) (F6).
  danglingHits counts sentences; danglingList names each.
- shippedOverflow: slides with text over its box, off the slide, printed over other text, or diagram
  labels clipped (geom overflow, offCanvas, overlaps, clipping) (F7); shippedOverflowKinds splits it.
- labelsDropped: the writer's figure/picture/diagram labels that are not on the shipped slide's text or
  SVG text, whatever path lost them (F8).
- recallSubtitle: lessons whose slide-1 subtitle is a pupil prompt (a question, or a recall cue in any
  language: Recall, Rappelle-toi, Name..., Say...), not a "Year N Subject" label (F10).
- --gate <band.json>: per-rep verdicts against a band; an arm passes only if every rep does. No mean
  is ever compared with the band (F9).
"""
import glob, html, json, os, re, sys, urllib.parse

# ---------------------------------------------------------------- words
STOP = set("""a an the to at of and or in on is are it its it's their his her them they this these that those each every both with for from as by be into out up how what which who why do does did can will would should could
point look looking trace label circle spot find name match compare sort count describe say tell show shown here below above closely carefully see notice you your our we us one ones next first then now
picture pictures photo photos photograph photographs diagram diagrams graph graphs map maps image images drawing drawings table tables chart charts figure figures timeline panel panels
all young adult adults small smaller big bigger large larger little baby female male grown fully partly different same other another two three four five still growing
left right middle top bottom row rows scale breed separated separate horizontal vertical arrows arrow labels clear clearly visible standing side""".split())
# Words a picture cannot be expected to name (F2): categories and verbs.
CATEGORY = set("""animal animals creature creatures bird birds thing things object objects part parts piece pieces change changes difference differences plant plants shape shapes family families people person item items stage stages food foods kind kinds type types group groups set sets member members pair pairs""".split())
VERBS = set("""come comes go goes grow grows change changes happen happens show shows look looks eat eats live lives need needs get gets become becomes start starts begin begins belong belongs match matches turn turns called named move moves make makes have has is are was were be been will can""".split())
ABSTRACT = set("""lesson lessons week time term question questions word words sentence sentences idea ideas way ways rule rules step steps method methods sum sums number numbers one ones process processes change changes model models theory topic text passage poem extract quote quotation answer answers task tasks point points case cases example examples fact facts reason reasons phrase phrases result results estimate estimates date dates interval test comparison claim threat average finding findings evidence study studies experiment experiments argument view distinction assumption pattern patterns proposal proposals investigation investigations person people explanation explanations definition definitions statement statements scenario situation approach strategy strategies problem problems calculation calculations value values equation equations variable variables transfer transfers prediction predictions conclusion conclusions hypothesis method data advantage advantages disadvantage disadvantages account accounts revision revisions version versions limitation limitations strength strengths weakness weaknesses criticism criticisms effect effects response responses feedback mistake mistakes error errors misconception misconceptions""".split())
PRONOUN_NEXT = set("""is are was were has have had could would might may can will should does do did not alone a an the means mean shows show suggests suggest supports support challenges challenge happen happens tells tell different same fair true right wrong important
help helps using use against for to with about by from into in on of at as differ differs work works affect affects explain explains matter matters apply applies lead leads cause causes relate relates compare compares change changes""".split())
ALIAS = {"hen": ["chicken"], "hens": ["chicken"], "chick": ["chicken"], "chicks": ["chicken"], "pullet": ["chicken", "hen"], "rooster": ["chicken"],
         "cockerel": ["chicken"], "calf": ["cattle"], "cow": ["cattle"], "longhorn": ["cow", "cattle"], "lamb": ["sheep"], "piece": ["part"], "pieces": ["part"]}
STRONG = re.compile(r"\b(point (to|at|and)|point out|look (at|closely|carefully)|looking at|trace (the|this|these|each)|label (the|this|these|each|it|them)|circle (the|this|these|each)|spot (the|this|these)|find (the|this|these) \w+ (in|on) the|(in|on|from) (the|this) (picture|photo|photograph|diagram|graph|map|image|drawing|table|chart|timeline)s?|(the|this) (diagram|graph|map|picture|photo|chart|figure|image) (shows|below|above)|shown (here|below|above)|use the (picture|photo|diagram|graph|map|table|chart|image)s?|can you see|what do you notice|which (picture|photo|animal|shape)s?\b)", re.I)
WEAK = re.compile(r"\b((match|compare|name|sort|count|label)\b(\s+\w+){0,2}?\s+(each|every|both|this|these|those|that)|say\s+(each|every|both))\b", re.I)
# "this/these <noun>" (one optional adjective) right before a verb or the end of the clause (F1).
DEICTIC = re.compile(r"\b(this|these|those)\s+(?:(young|adult|small|big|little|two|three|four|baby|first|second|last|grown|female|male)\s+)?([a-z]+)\b(?=\s+(is|are|was|were|has|have|shows?|looks?|will|can|grows?)\b|\s*[.?!,]|\s*$)", re.I)
OWNWORK = re.compile(r"\b(sketch|draw|plot|your (worksheet|book|books|sheet|whiteboard|graph|diagram|table)s?|your own (graph|diagram|table|drawing|sketch|picture)s?|in your (book|books|jotter))\b", re.I)
PICWORD = re.compile(r"\b(pictures?|photos?|photographs?|images?)\b", re.I)
POINT = re.compile(r"\b(look at|looking at|trace the|in the (picture|diagram|graph|map|photo|table)|the (diagram|graph|map|picture|photo|chart|figure) (shows|below|above)|shown (here|below|above)|use the (diagram|graph|map|picture|table|chart))\b", re.I)
NOT_TEACHING = {"title", "objectives", "hinge", "question-set", "practice", "exit-ticket", "discussion"}
QUESTION_KINDS = {"title", "objectives", "multiple-choice", "open-response", "starter", "discussion", "exit-ticket", "hinge"}
RECALL = re.compile(r"\?|\b(recall|remember|rappelle|souviens|recuerda|erinner|ricorda|think back|what do you know|can you (name|remember|say)|name (the|three|two|some|any|as)|say |count |tell |list |dis |nomme|cite )", re.I)

def forms(w):
    w = w.lower(); f = {w}
    if w.endswith("ies") and len(w) > 4: f.add(w[:-3] + "y")
    if w.endswith("es") and len(w) > 4: f.add(w[:-2])
    if w.endswith("s") and len(w) > 3: f.add(w[:-1])
    if w.endswith("y") and len(w) > 4: f.add(w[:-1])
    return f
def bag_of(text):
    bag = set()
    for w in re.findall(r"[a-zA-Z]+", html.unescape(text)):
        bag |= forms(w); bag.update(ALIAS.get(w.lower(), []))
    return bag
def subjects(phrase):
    """The words in a cue's object that a picture should show: not stop words, categories or verbs."""
    return [w for w in re.findall(r"[a-zA-Z]+", phrase) if len(w) > 2 and w.lower() not in STOP and not (forms(w) & (CATEGORY | VERBS))]

# ---------------------------------------------------------------- reading a run
def texts(o):
    if isinstance(o, dict):
        if o.get("type") == "text" and isinstance(o.get("text"), str): yield o["text"]
        for v in o.values(): yield from texts(v)
    elif isinstance(o, list):
        for v in o: yield from texts(v)
def slide_text(sl): return ["".join(texts(e.get("doc", {}))) for e in sl.get("elements", []) if e.get("type") == "text"]
def svg_text(e):
    if not str(e.get("src", "")).startswith("data:image/svg"): return []
    svg = urllib.parse.unquote(e["src"])
    svg = re.sub(r"</tspan>\s*<tspan", "</tspan> <tspan", svg)  # one word per line must not glue
    return re.findall(r'aria-label="([^"]*)"', svg) + [t for t in re.findall(r">([^<>]+)<", svg) if t.strip()]
def load(p):
    try:
        with open(p) as f: return json.load(f)
    except Exception: return None
def writer(r):
    try: return json.loads(load(f"{r}/main.json")["text"])
    except Exception:
        try:
            with open(f"{r}/stream.txt") as f: return json.loads(f.read())
        except Exception: return {}
def verdicts(r):
    """{lesson slide index (0-based): [accepted picture-judge verdict texts]} from pictures.log.jsonl."""
    out = {}
    try:
        for line in open(f"{r}/pictures.log.jsonl"):
            try: j = json.loads(line)
            except Exception: continue
            m = j.get("made")
            if isinstance(m, dict) and m.get("fits") and isinstance(j.get("slideIndex"), int):
                out.setdefault(j["slideIndex"], []).append(str(m.get("why") or ""))
    except OSError: pass
    return out

# ---------------------------------------------------------------- dangling
def images(sl): return [e for e in sl.get("elements", []) if e.get("type") == "image" and e.get("src")]
def is_svg(e): return str(e.get("src", "")).startswith("data:image/svg")
def shows_bag(sl, said):
    """What the slide's visuals show, from the shipped elements and the judge's accepted verdicts."""
    parts = []
    for e in images(sl):
        src = e.get("source") or {}; ev = src.get("evidence") or {}
        parts += [str(x) for x in ev.get("visible") or []]
        parts += [str(x.get("name")) for x in e.get("subjects") or [] if isinstance(x, dict)]
        parts += svg_text(e)
        if ev.get("visible") or not said: parts.append(e.get("alt") or "")
        elif src.get("provider") not in ("generated",): parts.append(e.get("alt") or "")
        if not ev.get("visible"): parts += said  # the verdict, never the request (F6)
    return bag_of(" ".join(parts))
def list_items(sl):
    """Short listed names on the slide ('cow . sheep', one-word points)."""
    out = []
    for e in sl.get("elements", []):
        if e.get("type") != "text": continue
        t = "".join(texts(e.get("doc", {})))
        if re.search(r"[•·]", t): out += [c for c in re.split(r"\s*[•·;/\n]\s*", t) if 0 < len(c.split()) <= 2]
    return out
def cue(sent):
    """(match, object, kind) for the first pointing cue in a sentence, else None."""
    m = STRONG.search(sent) or WEAK.search(sent)
    if m:
        obj = re.split(r"[,;:.?!]| and (?:say|name|tell|explain|write|describe|talk)\b| to its\b", sent[m.end():])[0]
        obj = re.split(r"\b(that|which|who|where|by|then|into|with|from)\b", obj)[0]
        ws = obj.split(); cut = next((i for i, w in enumerate(ws) if w.lower().strip("'’") in VERBS), len(ws))
        return m, " ".join(ws[:cut]), "cue"
    for d in DEICTIC.finditer(sent):
        noun = d.group(3).lower()
        if noun in PRONOUN_NEXT or noun in STOP or noun.endswith("ing") or noun.endswith("ed"): continue
        if d.group(1).lower() == "this" and noun.endswith("s") and not noun.endswith("ss"): continue
        if forms(noun) & ABSTRACT: continue
        return d, (d.group(2) or "") + " " + d.group(3), "deictic"
    return None
def dangling_hits(sl, said=(), request_vocab=frozenset()):
    """[(sentence, reason)] for one shipped slide. said: the judge's accepted verdicts for this slide."""
    ims = images(sl); has = bool(ims); svg = any(is_svg(e) for e in ims)
    bag = shows_bag(sl, list(said)) if has else set()
    own = bool(OWNWORK.search(" ".join(slide_text(sl))))
    out = []
    for t in slide_text(sl):
        for sent in re.split(r"(?<=[.?!])\s+|\n+", t):
            c = cue(sent)
            if not c: continue
            m, obj, kind = c; subj = subjects(obj or "")
            if not has:
                if own and kind == "cue": continue  # pupils make the thing themselves
                head = re.findall(r"[a-zA-Z]+", obj or "")
                if head and forms(head[-1]) & ABSTRACT: continue  # "name each transfer process"
                out.append((sent, f'"{m.group(0)}" with no visual on the slide')); continue
            if svg: continue  # a drawn diagram: presence only
            if not subj:
                # a category ("each animal's name"): the slide's own list names the subjects
                # ... or that the slide's text names and its picture was asked to show
                asked = bag_of(" ".join(e.get("request") or "" for e in ims))
                listed = [w for c2 in list_items(sl) for w in subjects(c2)] + [w for t2 in slide_text(sl) for w in subjects(t2) if forms(w) & asked]
                listed = list(dict.fromkeys(w.lower() for w in listed)) if kind == "cue" else []
                miss = [w for w in listed if not (forms(w) & bag)]
                if miss: out.append((sent, f'"{m.group(0)}" lists {", ".join(miss)}; no visual on the slide shows it')); continue
                # "the pictures" on a generated picture: the request's subjects must be in the verdict
                gen = [e for e in ims if (e.get("source") or {}).get("provider") == "generated"]
                if gen and said and PICWORD.search(sent):
                    vb = bag_of(" ".join(said))
                    req = {w.lower() for e in gen for w in subjects(e.get("request") or "") if forms(w) & request_vocab}
                    miss = sorted(w for w in req if not (forms(w) & vb))
                    if miss: out.append((sent, f'"{m.group(0)}": the picture was asked to show {", ".join(miss)}; the judge saw none'))
                continue
            miss = [w for w in subj if not (forms(w) & bag)]
            if miss: out.append((sent, f'"{m.group(0)}" names {", ".join(miss)}; no visual on the slide shows it'))
    return out

# ---------------------------------------------------------------- one lesson
def slide_no(b):
    """geom.json lists slides as 5, "5" or 's9 diagram label ... cut 9px'."""
    if isinstance(b, int): return b
    if isinstance(b, dict): return slide_no(b.get("slide"))
    m = re.match(r"\s*s?(\d+)\b", str(b)); return int(m.group(1)) if m else None
def norm(s): return " ".join(re.sub(r"[^\w]+", " ", html.unescape(s).casefold()).split())
def lesson_measures(r):
    """Per slide (from 3) measures plus lesson-level ones, or None when the lesson did not finish."""
    lesson = load(f"{r}/lesson.json")
    if not lesson or len(lesson.get("slides", [])) < 3: return None  # a crashed 1-slide stub
    slides = lesson["slides"]; w = writer(r); ws = w.get("slides") or []
    aligned = len(ws) == len(slides) - 2
    checks = load(f"{r}/checks.json") or {}; csum = checks.get("summary") or {}
    geom = (load(f"{r}/geom.json") or {}).get("summary")
    said = verdicts(r)
    vocab = set().union(*[bag_of(t) for sl in slides for t in slide_text(sl)]) if slides else set()
    per = {}; kinds = {}
    if geom is not None:
        for k in ("overflow", "offCanvas", "overlaps", "clipping"):
            for b in geom.get(k) or []:
                n = slide_no(b)
                if n is not None: kinds.setdefault(n, set()).add(k)
    for i, sl in enumerate(slides):
        if i < 2: continue
        k = i - 2; plan = ws[k] if aligned else None
        teach = (str(plan.get("template")) not in NOT_TEACHING) if plan is not None else (sl.get("kind") not in QUESTION_KINDS)
        shown = any(e.get("type") == "image" for e in sl.get("elements", []))
        tx = slide_text(sl)
        labs = []; figlabs = set()  # a drawn figure's labels must be on the figure; a picture's anywhere on the slide
        if plan is not None:
            for f in ("figure", "picture", "diagram"):
                if isinstance(plan.get(f), dict):
                    got = [str(x).strip() for x in plan[f].get("labels") or [] if str(x).strip()]; labs += got
                    if f != "picture" and plan[f].get("kind") not in ("photo", "picture"): figlabs |= set(got)
        # A label ships when it is on the figure: SVG text, or a label/callout element over the picture.
        on_fig = norm(" ".join([t for e in sl.get("elements", []) if e.get("type") == "image" for t in svg_text(e)]
                               + ["".join(texts(e.get("doc", {}))) for e in sl.get("elements", []) if e.get("type") == "text" and re.search(r"label|callout|tag", str(e.get("name")), re.I) and e.get("name") != "Key label"]))
        anywhere = norm(" ".join(tx)) + " " + on_fig
        def on(lab, where):
            if norm(lab) and norm(lab) in where: return True
            ps = [norm(p) for p in re.split(r"\s*/\s*", lab) if norm(p)]
            return bool(ps) and all(p in where for p in ps)
        dropped = [x for x in labs if not on(x, on_fig if x in figlabs else anywhere)]
        lost = [x for x in dropped if not on(x, anywhere)]
        hits = dangling_hits(sl, said.get(i, []), vocab)
        lowered = {x.lower() for x in labs}
        m = dict(teach=int(teach), shown=int(shown), textChars=sum(len(t) for t in tx), visualShownTeach=int(teach and shown),
                 textOnlyTeach=int(teach and not shown), danglingSlide=int(bool(hits)), danglingHits=len(hits), _hits=hits,
                 danglingLegacy=0 if shown else sum(1 for t in tx for p in re.split(r"(?<=[.?!])\s+", t) if POINT.search(p)),
                 labelStrings=sum(1 for t in tx if len(lowered) >= 2 and len([p for p in t.split(";") if p.strip().lower() in lowered]) >= 2),
                 labelsAsked=len(labs), labelsDropped=len(dropped), labelsLost=len(lost), _dropped=dropped,
                 elements=len(sl.get("elements", [])), images=sum(1 for e in sl.get("elements", []) if e.get("type") == "image"))
        if geom is not None: m["shippedOverflow"] = int(i + 1 in kinds); m["_kinds"] = sorted(kinds.get(i + 1, []))
        m["_sig"] = json.dumps([{kk: vv for kk, vv in e.items() if kk not in ("id", "source") and not (kk == "style" and isinstance(vv, str))} for e in sl.get("elements", [])], sort_keys=True)
        per[i + 1] = m
    # The harness's own text-only list is exact (ground truth 13/13); prefer it where the run has it.
    if isinstance(csum.get("textOnlySlides"), list):
        tos = {int(x) for x in csum["textOnlySlides"]}
        for n, m in per.items():
            if (n in tos) != bool(m["textOnlyTeach"]): m["harnessDisagree"] = 1
            if n in tos: m.update(teach=1, textOnlyTeach=1, visualShownTeach=0)
            elif m["textOnlyTeach"]: m.update(textOnlyTeach=0, teach=0)
    sub = [("".join(texts(e.get("doc", {})))) for e in slides[0].get("elements", []) if e.get("name") == "Subtitle"]
    recall = int(any(RECALL.search(s) for s in sub))
    return dict(slides=per, recall=recall, geom=geom is not None, harnessTextOnly=isinstance(csum.get("textOnlySlides"), list))

def run_metrics(runs_dir, retry=None, root=None):
    runs = sorted(d for d in glob.glob(f"{runs_dir}/*") if os.path.isdir(d))
    if retry: runs = [f"{retry}/{os.path.basename(r)}" if os.path.exists(f"{retry}/{os.path.basename(r)}") else r for r in runs]
    M = dict(lessons=0, slides=0, teach=0, visualShownTeach=0, visualSlidesShown=0, textChars=0, textOnlyTeach=0,
             shippedOverflow=0, shippedOverflowLessons=0, labelStrings=0, labelsAsked=0, labelsDropped=0, labelsLost=0,
             dangling=0, danglingHits=0, danglingLegacy=0, recallSubtitle=0, missingGeom=0, stubsSkipped=0, harnessDisagree=0)
    kinds = {}; LIST = []; DROP = []
    for r in runs:
        L = lesson_measures(r)
        if L is None:
            if os.path.exists(f"{r}/lesson.json"): M["stubsSkipped"] += 1
            continue
        M["lessons"] += 1; M["recallSubtitle"] += L["recall"]; over = 0
        if not L["geom"]: M["missingGeom"] += 1
        for n, m in L["slides"].items():
            M["slides"] += 1; M["visualSlidesShown"] += m["shown"]
            for k in ("teach", "visualShownTeach", "textChars", "textOnlyTeach", "labelStrings", "labelsAsked", "labelsDropped", "labelsLost", "danglingHits", "danglingLegacy"): M[k] += m[k]
            M["harnessDisagree"] += m.get("harnessDisagree", 0)
            M["dangling"] += m["danglingSlide"]; over += m.get("shippedOverflow", 0)
            for kk in m.get("_kinds", []): kinds[kk] = kinds.get(kk, 0) + 1
            rel = os.path.relpath(r, root or runs_dir)
            for sent, why in m["_hits"]: LIST.append(dict(lesson=rel, slide=n, text=sent[:120], why=why))
            for x in m["_dropped"]: DROP.append(dict(lesson=rel, slide=n, label=x))
        M["shippedOverflow"] += over; M["shippedOverflowLessons"] += bool(over)
    vs = round(M["visualShownTeach"] / max(1, M["teach"]), 3)
    return dict(M, visualShown=vs, textOnlyShare=round(M["textOnlyTeach"] / max(1, M["teach"]), 3),
                visualShare=round(M["visualSlidesShown"] / max(1, M["slides"]), 3), textChars=round(M["textChars"] / max(1, M["slides"]), 1),
                shippedOverflowKinds=kinds, danglingList=LIST, labelsDroppedList=DROP,
                note="textOnlyShare = 1 - visualShown on the same teaching slides: one measure, gated once (visualShown)")

# ---------------------------------------------------------------- per-rep gate (F9)
def gate(reps, band):
    """reps: {name: metrics}. band: {metric: [lo, hi]}. A rep passes only if every banded metric is
    inside; the arm passes only if every rep passes. Means are never compared with the band."""
    out = {}
    for name, m in reps.items():
        fails = {k: m.get(k) for k, (lo, hi) in band.items() if k in m and ((lo is not None and m[k] < lo) or (hi is not None and m[k] > hi))}
        out[name] = dict(pass_=not fails, fails=fails)
    return dict(reps=out, armPass=all(v["pass_"] for v in out.values()), rule="per rep, every rep; never on a mean")

def asks_visual(s):
    if any(isinstance(s.get(k), dict) for k in ("figure", "picture", "diagram")): return True
    return any(isinstance(c, dict) and isinstance(c.get("picture"), dict) for c in (s.get("columns") or [])) or bool(s.get("sequence"))
def make_band(full, writer_only):
    """The widened base band (D30 method on v2 teaching slides). full: the base's full reps (<run>/T);
    writer_only: its writer-only reps. Shipped metrics take the full reps' per-rep range. visualShown is
    widened by the writer's own spread: every writer rep's ask rate (teaching slides asking a visual)
    times the full reps' pooled delivery rate (shown / asked on teaching slides)."""
    reps = {d: run_metrics(d) for d in full}
    def ask(d):
        a = t = 0
        for r in sorted(glob.glob(f"{d}/*")):
            ws = writer(r).get("slides") or []
            for s in ws:
                if str(s.get("template")) in NOT_TEACHING: continue
                t += 1; a += asks_visual(s)
        return a / max(1, t)
    asked = shown = 0
    for d in full:
        for r in sorted(glob.glob(f"{d}/*")):
            L = lesson_measures(r); ws = writer(r).get("slides") or []
            if not L: continue
            for n, m in L["slides"].items():
                if m["teach"] and n - 3 < len(ws) and asks_visual(ws[n - 3]): asked += 1; shown += m["shown"]
    deliv = shown / max(1, asked); asks = {os.path.basename(os.path.dirname(os.path.abspath(d))): round(ask(d), 3) for d in list(full) + list(writer_only)}
    rng = lambda k: [min(m[k] for m in reps.values()), max(m[k] for m in reps.values())]
    vs = rng("visualShown"); lo = round(min(vs[0], min(asks.values()) * deliv), 3); hi = round(max(vs[1], max(asks.values()) * deliv), 3)
    return dict(visualShownReps=vs, writerAsk=asks, delivery=round(deliv, 3), widened=[lo, hi],
                textOnlyShare=[round(1 - hi, 3), round(1 - lo, 3)], ranges={k: rng(k) for k in ("dangling", "danglingHits", "shippedOverflow", "labelStrings", "labelsDropped", "labelsLost", "recallSubtitle", "textChars")},
                band={"visualShown": [lo, None], "dangling": [None, rng("dangling")[1]], "shippedOverflow": [None, rng("shippedOverflow")[1]],
                      "labelStrings": [None, rng("labelStrings")[1]], "labelsDropped": [None, rng("labelsDropped")[1]]},
                note="gate per rep with --gate; textOnlyShare is 1 - visualShown and is not gated")

def paired(runs_dir, base_dir, retry=None):
    import hashlib
    runs = sorted(d for d in glob.glob(f"{runs_dir}/*") if os.path.isdir(d))
    if retry: runs = [f"{retry}/{os.path.basename(r)}" if os.path.exists(f"{retry}/{os.path.basename(r)}") else r for r in runs]
    def wsig(r):
        for f in ("stream.txt", "main.json"):
            if os.path.exists(f"{r}/{f}"): return hashlib.sha256(open(f"{r}/{f}", "rb").read()).hexdigest()
    base = {os.path.basename(d): d for d in glob.glob(f"{base_dir}/*") if os.path.isdir(d)}
    P = dict(lessons=0, writerSame=0, slides=0, slidesChanged=0); D = {}; CH = []
    for r in runs:
        b = base.get(os.path.basename(r)); A = lesson_measures(r); B = lesson_measures(b) if b else None
        if A is None or B is None: continue
        A, B = A["slides"], B["slides"]
        P["lessons"] += 1; P["writerSame"] += wsig(r) == wsig(b)
        for n in sorted(set(A) | set(B)):
            a, bb = A.get(n, {}), B.get(n, {}); P["slides"] += 1
            P["slidesChanged"] += a.get("_sig") != bb.get("_sig")
            for key in sorted(k for k in set(a) | set(bb) if not k.startswith("_")):
                d = a.get(key, 0) - bb.get(key, 0)
                if d: D[key] = D.get(key, 0) + d; CH.append(dict(lesson=os.path.basename(r), slide=n, metric=key, base=bb.get(key), arm=a.get(key)))
    return dict(P, note="writer identical in writerSame of lessons: differences there are code-only", delta=D, changes=CH)

if __name__ == "__main__":
    argv = sys.argv[1:]; opt = {}
    if argv and argv[0] == "--band":  # metrics.py --band <full rep T dirs, comma-joined> <writer-only T dirs, comma-joined>
        print(json.dumps(make_band(argv[1].split(","), argv[2].split(",") if len(argv) > 2 else []), indent=1)); sys.exit(0)
    for flag in ("--paired-with", "--gate"):
        if flag in argv:
            k = argv.index(flag); opt[flag] = argv[k + 1]; del argv[k:k + 2]
    if "--paired-with" in opt:
        print(json.dumps(paired(argv[0], opt["--paired-with"], argv[1] if len(argv) > 1 else None))); sys.exit(0)
    if "--gate" in opt:  # metrics.py --gate band.json <rep runs dir>... (each a <run>/T dir)
        band = json.load(open(opt["--gate"]))["band"]
        reps = {d: {k: v for k, v in run_metrics(d).items() if not isinstance(v, (list, dict))} for d in argv}
        print(json.dumps(gate(reps, band))); sys.exit(0)
    print(json.dumps(run_metrics(argv[0], argv[1] if len(argv) > 1 else None)))
