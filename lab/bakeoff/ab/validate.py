"""Strict-schema subset validator (no deps): validate.py <schema.json> <output.json|main.json> ... -> errors."""
import json, sys
def check(s, v, root, path, errs):
    if "$ref" in s: return check(root["$defs"][s["$ref"].split("/")[-1]], v, root, path, errs)
    if "anyOf" in s:
        for o in s["anyOf"]:
            e = []; check(o, v, root, path, e)
            if not e: return
        errs.append(f"{path}: matches no anyOf branch"); return
    t = s.get("type")
    ok = {"object": isinstance(v, dict), "array": isinstance(v, list), "string": isinstance(v, str),
          "integer": isinstance(v, int) and not isinstance(v, bool), "null": v is None}.get(t, True)
    if not ok: errs.append(f"{path}: not {t}"); return
    if "enum" in s and v not in s["enum"]: errs.append(f"{path}: {v!r} not in enum")
    if t == "integer":
        if "minimum" in s and v < s["minimum"]: errs.append(f"{path}: {v} < {s['minimum']}")
        if "maximum" in s and v > s["maximum"]: errs.append(f"{path}: {v} > {s['maximum']}")
    if t == "array":
        if len(v) < s.get("minItems", 0): errs.append(f"{path}: {len(v)} items < {s['minItems']}")
        if len(v) > s.get("maxItems", 10**9): errs.append(f"{path}: {len(v)} items > {s['maxItems']}")
        for i, x in enumerate(v): check(s["items"], x, root, f"{path}[{i}]", errs)
    if t == "object":
        props = s.get("properties", {})
        for k in s.get("required", []):
            if k not in v: errs.append(f"{path}: missing {k}")
        for k, x in v.items():
            if k not in props:
                if s.get("additionalProperties") is False: errs.append(f"{path}: extra {k}")
            else: check(props[k], x, root, f"{path}.{k}", errs)
if __name__ == "__main__":
    s = json.load(open(sys.argv[1])); n = 0
    for f in sys.argv[2:]:
        d = json.load(open(f)); d = json.loads(d["text"]) if "text" in d and "flow" not in d else d
        e = []; check(s, d, s, "$", e); n += len(e)
        print(f, len(e), e[:3])
    sys.exit(1 if n else 0)
