import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { withTestDb } from "@tj/db/testing";
import { sql } from "drizzle-orm";
import {
  addAlias,
  addEdge,
  addSection,
  appendFacts,
  buildCardText,
  CARD_TEMPLATE_VERSION,
  createPack,
  createSource,
  deprecateFact,
  type FactEvidence,
  findAlias,
  findCandidates,
  findMissingEvidence,
  findSectionsByOutcome,
  getPack,
  getSectionFactCounts,
  getThreshold,
  hashText,
  type KnowledgeDb,
  KnowledgeStoreError,
  listAliases,
  listCurrentFacts,
  listExclusionPhrases,
  listFactHistory,
  listSectionsNeedingEmbedding,
  logMatch,
  type NewFact,
  normaliseText,
  putSectionEmbedding,
  rebuildDerived,
  recordFactSignal,
  setExclusionPhraseEmbedding,
  setPackStatus,
  upsertThreshold,
  withSubjectLock,
} from "./index";

// ---------------------------------------------------------------------------------------------
// Pure helpers: no database needed.
// ---------------------------------------------------------------------------------------------

describe("text keys", () => {
  test("normaliseText folds case, quotes, dashes, spaces and trailing punctuation", () => {
    expect(normaliseText("  I can explain Freud’s  “id” — ego.  ")).toBe(
      'i can explain freud\'s "id" - ego',
    );
  });

  test("hashText is stable across surface variants and differs on content", () => {
    expect(hashText("I can explain the id, ego and superego.")).toBe(
      hashText("i can explain the id, ego and superego"),
    );
    expect(hashText("I can explain the id")).not.toBe(hashText("I can explain the ego"));
  });

  test("buildCardText carries subject, band, pack title, outcome, scope and key words, never exclusions", () => {
    const text = buildCardText({
      subject: "psychology",
      band: 12,
      packTitle: "Freud's psychodynamic theory",
      outcome: "I can explain the structural model",
      scopeLine: "Covers id, ego and superego",
      keyWords: ["id", "ego", "superego"],
    });
    expect(text).toBe(
      "psychology · band 12 · Freud's psychodynamic theory\nI can explain the structural model\nCovers id, ego and superego\nKey words: id, ego, superego",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Against the compose Postgres (pgvector). Skips with a reason when TEST_DATABASE_URL is unset.
// ---------------------------------------------------------------------------------------------

const t = await withTestDb({ max: 6 });
const describeDb = t.ok ? describe : describe.skip;
if (!t.ok) console.warn(`skipping knowledge store tests: ${t.reason}`);

const MODEL = "test-embed";
const DIMS = 4;
const PIPE = "test-pipeline-1";

describeDb("knowledge store", () => {
  if (!t.ok) return;
  const { unsafeDb: db, truncateKnowledgeTables, close } = t.db;
  afterAll(() => close());
  beforeEach(() => truncateKnowledgeTables());

  async function seedSource(kdb: KnowledgeDb = db) {
    return createSource(kdb, {
      url: "https://en.wikipedia.org/wiki/Id,_ego_and_superego",
      title: "Id, ego and superego",
      publisher: "Wikipedia",
      licence: "CC BY-SA 4.0",
      licenceClass: "open",
      fetchedAt: new Date("2026-09-01T00:00:00Z"),
      contentHash: "abc123",
      sentences: [
        "The id is the primitive and instinctual part of the mind.",
        "The ego is the realistic part that mediates between the desires of the id and the superego.",
        "Freud wrote that the ego is not master in its own house.",
      ],
    });
  }

  async function seedPackAndSection(kdb: KnowledgeDb = db) {
    const pack = await createPack(kdb, {
      slug: "psych-freud-psychodynamic",
      subject: "psychology",
      bandLo: 12,
      bandHi: 13,
      scopeTitle: "Freud's psychodynamic theory",
    });
    const section = await addSection(kdb, {
      packId: pack.id,
      band: 12,
      outcome: "I can explain Freud's structural model of the mind.",
      scopeLine: "Covers the id, ego and superego and how they interact.",
      keyWords: ["id", "ego", "superego", "structural model"],
      exclusionPhrases: ["Freud's critics", "Popper on falsifiability"],
    });
    return { pack, section };
  }

  const keyIdea = (evidence: FactEvidence[], extra: Partial<NewFact> = {}): NewFact => ({
    type: "keyIdea",
    text: "In Freud's structural model, the id is the primitive, instinctual part of the mind.",
    evidence,
    provenance: "verified",
    checkerModels: ["cheap", "sol"],
    checkConfidence: 0.9,
    pipelineVersion: PIPE,
    verifiedAt: new Date(),
    verifiedBy: "test",
    ...extra,
  });

  test("addSection stores the canonical alias and exclusion phrases; findAlias matches by normalised hash", async () => {
    const { pack, section } = await seedPackAndSection();
    const aliases = await listAliases(db, section.id);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({ kind: "canonical", label: "positive", vector: null });

    const hits = await findAlias(
      db,
      hashText("i can explain freud's structural model of the mind"),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      sectionId: section.id,
      packId: pack.id,
      subject: "psychology",
      band: 12,
    });

    const sameOutcome = await findSectionsByOutcome(
      db,
      "I CAN explain Freud's structural model of the mind",
    );
    expect(sameOutcome.map((s) => s.id)).toEqual([section.id]);

    // A flagged pack drops out of the alias lookup at once (TG-R05).
    await setPackStatus(db, pack.id, "flagged");
    expect(await findAlias(db, hashText(section.outcome))).toEqual([]);
  });

  test("addAlias upserts per (section, hash): a later verdict flips the label", async () => {
    const { section } = await seedPackAndSection();
    const text = "Describe the id, ego and superego";
    await addAlias(db, { sectionId: section.id, text, kind: "judge", label: "positive" });
    const flipped = await addAlias(db, {
      sectionId: section.id,
      text,
      kind: "teacher",
      label: "negative",
    });
    expect(flipped.label).toBe("negative");
    expect(await listAliases(db, section.id)).toHaveLength(2);
    const hits = await findAlias(db, hashText(text));
    expect(hits.map((h) => h.alias.label)).toEqual(["negative"]);
  });

  test("appendFacts refuses evidence that does not exist and quotations that are not verbatim", async () => {
    const { section } = await seedPackAndSection();
    const source = await seedSource();

    const missing = await findMissingEvidence(db, [{ sourceId: source.id, sentenceIds: [1, 99] }]);
    expect(missing).toEqual([{ sourceId: source.id, sentenceIds: [99] }]);

    await expect(
      appendFacts(db, section.id, [keyIdea([{ sourceId: source.id, sentenceIds: [99] }])]),
    ).rejects.toMatchObject({ code: "missing_evidence" });

    await expect(
      appendFacts(db, section.id, [
        {
          type: "quotation",
          text: "the ego is master in its own house",
          evidence: [{ sourceId: source.id, sentenceIds: [3] }],
          provenance: "verified",
          pipelineVersion: PIPE,
        },
      ]),
    ).rejects.toMatchObject({ code: "quotation_not_verbatim" });

    const [quote] = await appendFacts(db, section.id, [
      {
        type: "quotation",
        text: "The ego is not master in its own house",
        evidence: [{ sourceId: source.id, sentenceIds: [3] }],
        provenance: "verified",
        pipelineVersion: PIPE,
      },
    ]);
    expect(quote?.type).toBe("quotation");
    expect(await listFactHistory(db, section.id)).toHaveLength(1);
  });

  test("facts are append-only: superseding marks the old row and kb_fact_current shows the new one", async () => {
    const { section } = await seedPackAndSection();
    const source = await seedSource();
    const ev = [{ sourceId: source.id, sentenceIds: [1] }];
    const [v1] = await appendFacts(db, section.id, [keyIdea(ev)]);
    if (!v1) throw new Error("no v1");

    const [v2] = await appendFacts(db, section.id, [
      keyIdea(ev, {
        text: "The id is the instinctual part of the mind (corrected).",
        supersedesId: v1.id,
      }),
    ]);
    if (!v2) throw new Error("no v2");

    const history = await listFactHistory(db, section.id);
    expect(history).toHaveLength(2);
    const old = history.find((f) => f.id === v1.id);
    expect(old?.supersededBy).toBe(v2.id);
    expect(old?.supersededAt).toBeInstanceOf(Date);
    expect(v2.supersedesId).toBe(v1.id);

    const current = await listCurrentFacts(db, [section.id]);
    expect(current.map((f) => f.id)).toEqual([v2.id]);

    // Superseding twice is refused; superseding a fact of another section is refused.
    await expect(
      appendFacts(db, section.id, [keyIdea(ev, { supersedesId: v1.id })]),
    ).rejects.toMatchObject({ code: "already_superseded" });

    // Retirement: a deprecated copy supersedes; nothing is deleted.
    const retired = await deprecateFact(db, v2.id, "duplicate of a preferred row", {
      verifiedBy: "reviewer",
    });
    expect(retired).toMatchObject({
      rank: "deprecated",
      supersedesId: v2.id,
      deprecatedReason: "duplicate of a preferred row",
    });
    expect(await listCurrentFacts(db, [section.id])).toEqual([]);
    expect(await listFactHistory(db, section.id)).toHaveLength(3);
  });

  test("kb_fact_current serves only verified / human-reviewed rows inside validity and freshness", async () => {
    const { section } = await seedPackAndSection();
    const source = await seedSource();
    const ev = [{ sourceId: source.id, sentenceIds: [2] }];
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    const rows = await appendFacts(db, section.id, [
      keyIdea(ev, { text: "served: verified timeless" }),
      keyIdea(ev, { text: "served: human-reviewed", provenance: "human-reviewed" }),
      keyIdea(ev, { text: "hidden: model-proposed", provenance: "model-proposed" }),
      keyIdea(ev, {
        text: "served: slow past refresh (stale-while-revalidate)",
        volatility: "slow",
        refreshAfter: past,
      }),
      keyIdea(ev, { text: "hidden: fast past refresh", volatility: "fast", refreshAfter: past }),
      keyIdea(ev, { text: "hidden: asOf past refresh", asOf: past, refreshAfter: past }),
      keyIdea(ev, {
        text: "served: fast before refresh",
        volatility: "fast",
        refreshAfter: future,
      }),
      keyIdea(ev, { text: "hidden: not yet valid", validFrom: future }),
      keyIdea(ev, { text: "hidden: expired", validTo: past }),
      keyIdea(ev, { text: "served: preferred", rank: "preferred" }),
    ]);
    expect(rows).toHaveLength(10);
    const current = await listCurrentFacts(db, [section.id]);
    expect(current.map((f) => f.text).sort()).toEqual([
      "served: fast before refresh",
      "served: human-reviewed",
      "served: preferred",
      "served: slow past refresh (stale-while-revalidate)",
      "served: verified timeless",
    ]);
    expect(current[0]?.text).toBe("served: preferred");
    const [counts] = await getSectionFactCounts(db, [section.id]);
    expect(counts).toMatchObject({ keyIdeas: 5, total: 5, vocabulary: 0 });
  });

  test("one current vocabulary definition per (section, term, sense, band); superseding replaces it", async () => {
    const { section } = await seedPackAndSection();
    const source = await seedSource();
    const ev = [{ sourceId: source.id, sentenceIds: [1] }];
    const vocab = (extra: Partial<NewFact>): NewFact =>
      keyIdea(ev, {
        type: "vocabulary",
        termId: "id",
        sense: "psychoanalysis",
        band: 12,
        text: "id: the instinctual part",
        ...extra,
      });
    const [first] = await appendFacts(db, section.id, [vocab({})]);
    await expect(
      appendFacts(db, section.id, [vocab({ text: "a second current definition" })]),
    ).rejects.toThrow();
    // Same term at another band, or another sense, is a second valid definition.
    await appendFacts(db, section.id, [
      vocab({ band: 9, text: "id (KS3 pitch)" }),
      vocab({ sense: "everyday", text: "id: a card" }),
    ]);
    // A correction supersedes in one transaction and passes the index.
    const [second] = await appendFacts(db, section.id, [
      vocab({ text: "id: corrected", supersedesId: first?.id }),
    ]);
    const current = await listCurrentFacts(db, [section.id]);
    expect(current.map((f) => f.id).sort()).toEqual(
      [second?.id, ...current.filter((f) => f.id !== second?.id).map((f) => f.id)].sort(),
    );
    expect(current).toHaveLength(3);
    const [counts] = await getSectionFactCounts(db, [section.id]);
    expect(counts?.vocabulary).toBe(3);
  });

  test("rebuildDerived is idempotent, bumps versions on change and flags stale embeddings", async () => {
    const { section, pack } = await seedPackAndSection();
    const d1 = await rebuildDerived(db, section.id);
    expect(d1.changed).toBe(true);
    expect(d1.needsEmbedding).toBe(true);
    expect(d1.cardTemplateVersion).toBe(CARD_TEMPLATE_VERSION);
    expect(d1.cardText).toContain("psychology · band 12 · Freud's psychodynamic theory");
    expect(d1.cardText).not.toContain("critics");
    expect(d1.counts.total).toBe(0);

    const d2 = await rebuildDerived(db, section.id);
    expect(d2.changed).toBe(false);
    expect(d2.builtFromHash).toBe(d1.builtFromHash);

    await putSectionEmbedding(db, {
      sectionId: section.id,
      embeddingModel: MODEL,
      dims: DIMS,
      vector: [1, 0, 0, 0],
      cardTemplateVersion: CARD_TEMPLATE_VERSION,
      builtFromHash: d1.builtFromHash,
    });
    expect((await rebuildDerived(db, section.id)).needsEmbedding).toBe(false);
    expect(await listSectionsNeedingEmbedding(db, { embeddingModel: MODEL, dims: DIMS })).toEqual(
      [],
    );
    expect(
      await listSectionsNeedingEmbedding(db, { embeddingModel: "other", dims: DIMS }),
    ).toHaveLength(1);

    // Changing a card input makes the stored embedding stale.
    await db.execute(
      sql`update kb_section set key_words = '{"id","ego"}' where id = ${section.id}`,
    );
    const d3 = await rebuildDerived(db, section.id);
    expect(d3.changed).toBe(true);
    expect(d3.builtFromHash).not.toBe(d1.builtFromHash);
    expect(d3.needsEmbedding).toBe(true);
    expect(
      (await listSectionsNeedingEmbedding(db, { embeddingModel: MODEL, dims: DIMS })).map(
        (s) => s.id,
      ),
    ).toEqual([section.id]);
    const packNow = await getPack(db, pack.id);
    expect(packNow?.version).toBe(3);
  });

  test("findCandidates filters by subject and band, scans exactly, takes the best alias and reports exclusions", async () => {
    const { pack, section: s1 } = await seedPackAndSection();
    const embed = async (sectionId: string, vector: number[]) => {
      const d = await rebuildDerived(db, sectionId);
      await putSectionEmbedding(db, {
        sectionId,
        embeddingModel: MODEL,
        dims: DIMS,
        vector,
        cardTemplateVersion: CARD_TEMPLATE_VERSION,
        builtFromHash: d.builtFromHash,
      });
    };
    const s2 = await addSection(db, {
      packId: pack.id,
      band: 13,
      outcome: "I can evaluate Freud's theory.",
      scopeLine: "Strengths and limits.",
      keyWords: ["evaluate", "freud"],
    });
    const s3 = await addSection(db, {
      packId: pack.id,
      band: 9,
      outcome: "I can describe the unconscious mind at KS3.",
      scopeLine: "Iceberg model.",
      keyWords: ["unconscious"],
    });
    const other = await createPack(db, {
      slug: "bio-cells",
      subject: "biology",
      bandLo: 12,
      bandHi: 12,
      scopeTitle: "Cells",
    });
    const s4 = await addSection(db, {
      packId: other.id,
      band: 12,
      outcome: "I can describe the cell membrane.",
      scopeLine: "Structure.",
      keyWords: ["cell"],
    });
    await embed(s1.id, [1, 0, 0, 0]);
    await embed(s2.id, [0.6, 0.8, 0, 0]);
    await embed(s3.id, [1, 0, 0, 0]); // band 9: outside 12 ± 1
    await embed(s4.id, [1, 0, 0, 0]); // biology: wrong subject

    const query = [0.9, 0.1, 0, 0];
    const filter = {
      subject: "psychology",
      band: 12,
      embeddingModel: MODEL,
      dims: DIMS,
      objectiveText: "explain the id, ego and superego",
    };
    const c1 = await findCandidates(db, filter, query);
    expect(c1.map((c) => c.sectionId)).toEqual([s1.id, s2.id]);
    expect(c1[0]?.cosine).toBeCloseTo(0.9 / Math.hypot(0.9, 0.1), 5);
    expect(c1[0]?.matchedBy).toBe("card");
    // 3 of 4 key-word lexemes of s1 ("id", "ego", "superego", "structural model" → id, ego, superego, structur, model) appear in the objective.
    expect(c1[0]?.keyWordOverlap).toBeCloseTo(3 / 5, 5);
    expect(c1[0]?.exclusionSimilarity).toBeNull();
    expect(c1[1]?.keyWordOverlap).toBe(0);

    // A positive alias closer to the query lifts s2's score above s1.
    await addAlias(db, {
      sectionId: s2.id,
      text: "Explain the id ego superego",
      kind: "judge",
      label: "positive",
      embedding: { embeddingModel: MODEL, dims: DIMS, vector: [0.9, 0.1, 0, 0] },
    });
    const c2 = await findCandidates(db, filter, query);
    expect(c2[0]).toMatchObject({ sectionId: s2.id, matchedBy: "alias" });
    expect(c2[0]?.cosine).toBeCloseTo(1, 5);

    // Exclusion phrase similarity is reported, not judged.
    const [phrase] = await listExclusionPhrases(db, s1.id);
    if (!phrase) throw new Error("no phrase");
    await setExclusionPhraseEmbedding(db, phrase.id, {
      embeddingModel: MODEL,
      dims: DIMS,
      vector: [0, 0, 1, 0],
    });
    const c3 = await findCandidates(db, filter, [0, 0, 1, 0], 5);
    expect(c3.find((c) => c.sectionId === s1.id)?.exclusionSimilarity).toBeCloseTo(1, 5);

    // Stale embedding (hash changed) is never matched; a flagged pack is excluded; k limits.
    await db.execute(sql`update kb_section set key_words = '{"changed"}' where id = ${s1.id}`);
    await rebuildDerived(db, s1.id);
    expect((await findCandidates(db, filter, query)).map((c) => c.sectionId)).toEqual([s2.id]);
    expect(await findCandidates(db, { ...filter, bandSlack: 5 }, query, 1)).toHaveLength(1);
    await setPackStatus(db, pack.id, "flagged");
    expect(await findCandidates(db, filter, query)).toEqual([]);
    await expect(findCandidates(db, filter, [1, 0])).rejects.toMatchObject({
      code: "dims_mismatch",
    });
  });

  test("withSubjectLock serialises writers on the same subject and not across subjects", async () => {
    const order: string[] = [];
    const hold = (subject: string, label: string, ms: number) =>
      withSubjectLock(db, subject, async () => {
        order.push(`${label}:start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${label}:end`);
      });
    const a = hold("psychology", "a", 150);
    await new Promise((r) => setTimeout(r, 20));
    const b = hold("psychology", "b", 10);
    const c = hold("biology", "c", 10);
    await Promise.all([a, b, c]);
    expect(order.indexOf("b:start")).toBeGreaterThan(order.indexOf("a:end"));
    expect(order.indexOf("c:end")).toBeLessThan(order.indexOf("a:end"));
  });

  test("thresholds, match log, fact signals, sources and edges round-trip", async () => {
    const { section } = await seedPackAndSection();
    const key = {
      subject: "psychology",
      embeddingModel: MODEL,
      dims: DIMS,
      cardTemplateVersion: CARD_TEMPLATE_VERSION,
    };
    expect(await getThreshold(db, key)).toBeNull();
    await upsertThreshold(db, {
      ...key,
      tauHit: 0.9,
      tauGrey: 0.7,
      kwFloor: 0.5,
      marginMin: 0.05,
      tauExcl: 0.85,
      calibratedAt: new Date(),
      nLabels: 300,
    });
    await upsertThreshold(db, {
      ...key,
      tauHit: 0.92,
      tauGrey: 0.7,
      kwFloor: 0.5,
      marginMin: 0.05,
      tauExcl: 0.85,
      calibratedAt: new Date(),
      nLabels: 350,
    });
    expect((await getThreshold(db, key))?.tauHit).toBeCloseTo(0.92, 5);

    const log = await logMatch(db, {
      objectiveHash: hashText("x"),
      subject: "psychology",
      band: 12,
      embeddingModel: MODEL,
      dims: DIMS,
      candidates: [
        {
          sectionId: section.id,
          packId: section.packId,
          cosine: 0.8,
          keyWordOverlap: 0.5,
          exclusionSimilarity: null,
        },
      ],
      decision: "grey",
      verdict: { sectionId: section.id, covers: "partial" },
      matchedSectionId: section.id,
      latencyMs: 12,
    });
    expect(log.id).toBeGreaterThan(0);
    await recordFactSignal(db, {
      kind: "edit",
      packFactIds: [],
      subject: "psychology",
      band: 12,
      teacherPseudonym: "t-1",
      beforeText: "a",
      afterText: "b",
    });

    const source = await seedSource();
    expect((await seedSource()).id).toBe(source.id); // idempotent on (url, contentHash)
    await expect(
      createSource(db, {
        url: "https://x",
        title: "x",
        licence: "spec",
        licenceClass: "readonly",
        fetchedAt: new Date(),
        contentHash: "h",
        sentences: ["no"],
      }),
    ).rejects.toMatchObject({ code: "licence_class_violation" });
    await expect(
      createSource(db, {
        url: "https://sep",
        title: "SEP",
        licence: "SEP",
        licenceClass: "quotable",
        fetchedAt: new Date(),
        contentHash: "h2",
        rawStorageKey: "k",
        sentences: [{ seq: 41, text: "cited" }],
      }),
    ).rejects.toMatchObject({ code: "licence_class_violation" });
    const sep = await createSource(db, {
      url: "https://sep",
      title: "SEP",
      licence: "SEP",
      licenceClass: "quotable",
      fetchedAt: new Date(),
      contentHash: "h2",
      sentences: [{ seq: 41, text: "cited" }],
    });
    expect(await findMissingEvidence(db, [{ sourceId: sep.id, sentenceIds: [41] }])).toEqual([]);

    const e1 = await addEdge(db, {
      fromId: section.id,
      toUri: "oak:lesson/abc",
      type: "aligned-to",
      origin: "oak",
      status: "verified",
    });
    const e2 = await addEdge(db, {
      fromId: section.id,
      toUri: "oak:lesson/abc",
      type: "aligned-to",
      origin: "oak",
    });
    expect(e2.id).toBe(e1.id);
    await expect(
      addEdge(db, { fromId: section.id, type: "supersedes", origin: "authored" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      addEdge(db, {
        fromId: section.id,
        toId: section.id,
        toUri: "u",
        type: "supersedes",
        origin: "authored",
      }),
    ).rejects.toBeInstanceOf(KnowledgeStoreError);
  });
});
