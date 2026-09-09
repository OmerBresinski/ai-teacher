/**
 * An in-memory stand-in for the documents API, for `bun test` (ADR 0024 §9: the mock store is
 * gone; unit tests stub the transport instead). `installFakeApi()` swaps `globalThis.fetch` so the
 * real RPC client in `@/lib/api` talks to this module: the same routes, status codes, envelopes and
 * `409 stale` / `409 generating` semantics as `apps/api/src/routes/documents.ts`, seeded with
 * `demoWorkspace()` under its **keys** as ids (`demo-water-cycle`, `series-romans`, …) so tests
 * can address fixtures by name. Ids minted here are uuids, as the server's are.
 */
import { newId } from "@tj/domain";
import {
  type DocumentKind,
  type Lesson,
  lessonFromBrief,
  type Series,
  summarise,
  type Worksheet,
} from "@tj/domain/documents";
import { demoWorkspace } from "@tj/editor/starter";

type Body = Lesson | Worksheet | Series;

export type FakeRow = {
  id: string;
  kind: DocumentKind;
  body: Body;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  generatingJobId: string | null;
};

export type FakeRequest = { method: string; path: string; query: URLSearchParams; body: unknown };

const API_PREFIX = "/api";
const PAGE_DEFAULT = 100;

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function error(status: number, code: string, message: string, extra: object = {}): Response {
  return json(status, { error: { code, message, requestId: "fake", retryable: false, ...extra } });
}

function summaryJson(row: FakeRow) {
  const s = summarise(row.body);
  return {
    ...s,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
    generatingJobId: row.generatingJobId,
  };
}

function documentJson(row: FakeRow) {
  return { ...summaryJson(row), body: row.body };
}

/** Strictly later than the previous stamp, as the repository's `nextUpdatedAt`. */
function nextStamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}

export class FakeApi {
  readonly rows = new Map<string, FakeRow>();
  /** Every request served, oldest first, for assertions on the wire shape. */
  readonly requests: FakeRequest[] = [];
  /** When set, the next matching request fails with this response instead. */
  private failures: { match: (request: FakeRequest) => boolean; response: () => Response }[] = [];

  constructor() {
    this.reset();
  }

  /** Back to the demo Workspace, keys as ids. */
  reset(): void {
    this.rows.clear();
    this.requests.length = 0;
    this.failures = [];
    this.nextProposalJobId = null;
    for (const item of demoWorkspace(new Date())) {
      this.rows.set(item.key, {
        id: item.key,
        kind: item.kind,
        body: structuredClone(item.body),
        createdAt: item.body.createdAt,
        updatedAt: item.body.updatedAt,
        deletedAt: null,
        generatingJobId: null,
      });
    }
  }

  /** Fail the next request `match` accepts with `response`; one-shot. */
  failNext(match: (request: FakeRequest) => boolean, response: () => Response): void {
    this.failures.push({ match, response });
  }

  live(kind?: DocumentKind): FakeRow[] {
    return [...this.rows.values()].filter(
      (row) => row.deletedAt === null && (kind === undefined || row.kind === kind),
    );
  }

  get(id: string): FakeRow | undefined {
    return this.rows.get(id);
  }

  /** A copy of a live document's body, or `null` — what the old mock store's `loadDocument` gave. */
  loadDocument(id: string): Body | null {
    const row = this.rows.get(id);
    return row && row.deletedAt === null ? structuredClone(row.body) : null;
  }

  /** Live lesson and worksheet summaries, newest edit first. */
  listDocuments(): ReturnType<typeof summaryJson>[] {
    return [...this.live("lesson"), ...this.live("worksheet")]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summaryJson);
  }

  /** Live series with their lessons, newest edit first. */
  listSeriesWithLessons(): { series: Series; lessons: ReturnType<typeof summaryJson>[] }[] {
    return this.live("series")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((row) => ({
        series: { ...(row.body as Series), createdAt: row.createdAt, updatedAt: row.updatedAt },
        lessons: (row.body as Series).lessonIds.flatMap((lessonId) => {
          const lesson = this.rows.get(lessonId);
          return lesson && lesson.deletedAt === null ? [summaryJson(lesson)] : [];
        }),
      }));
  }

  /** One Pexels hit in the api's shape, for the editor's Photos tab tests. */
  photoFixture(id: string) {
    return {
      id,
      width: 6000,
      height: 4000,
      alt: `Photo ${id}`,
      photographer: "Ada",
      photographerUrl: "https://www.pexels.com/@ada/",
      pageUrl: `https://www.pexels.com/photo/${id}/`,
      src: {
        large: `https://images.pexels.com/photos/${id}/large.jpeg`,
        medium: `https://images.pexels.com/photos/${id}/medium.jpeg`,
        tiny: `https://images.pexels.com/photos/${id}/tiny.jpeg`,
      },
    };
  }

  private searchImages(): Response {
    return json(200, {
      photos: [this.photoFixture("1"), this.photoFixture("2")],
      nextPage: 2,
    });
  }

  private pickImage(input: unknown): Response {
    const { id } = (input ?? {}) as { id?: string };
    const photoId = typeof id === "string" && id ? id : "1";
    const photo = this.photoFixture(photoId);
    const key = `00000000-0000-4000-8000-000000000001/images/${photoId}.jpg`;
    return json(201, {
      key,
      url: `/files/${key}`,
      width: photo.width,
      height: photo.height,
      bytes: 1024,
      contentType: "image/jpeg",
      source: {
        provider: "pexels",
        id: photo.id,
        pageUrl: photo.pageUrl,
        photographer: photo.photographer,
        photographerUrl: photo.photographerUrl,
      },
    });
  }

  /** Lock a lesson as `POST /lessons` would; `null` unlocks. */
  setGenerating(id: string, jobId: string | null): void {
    const row = this.rows.get(id);
    if (row) row.generatingJobId = jobId;
  }

  /** Advance a row's clock as another tab's save would, so the next `PUT` is `409 stale`. */
  touch(id: string): void {
    const row = this.rows.get(id);
    if (row) row.updatedAt = nextStamp(row.updatedAt);
  }

  /** The `fetch` the RPC client calls. Non-API URLs fall through to `passthrough`. */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url, "http://localhost");
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      return error(404, "not_found", `fake api: no route for ${url.pathname}`);
    }
    const path = url.pathname.slice(API_PREFIX.length);
    const body =
      request.method === "GET" || request.method === "DELETE"
        ? undefined
        : await request.json().catch(() => undefined);
    const record: FakeRequest = { method: request.method, path, query: url.searchParams, body };
    this.requests.push(record);
    const failure = this.failures.findIndex((entry) => entry.match(record));
    if (failure !== -1) {
      const [entry] = this.failures.splice(failure, 1);
      if (entry) return entry.response();
    }
    return this.route(record);
  };

  private route({ method, path, query, body }: FakeRequest): Response {
    const segments = path.split("/").filter(Boolean);
    if (segments[0] === "documents") {
      if (segments.length === 1 && method === "GET") return this.list(query);
      if (segments.length === 1 && method === "POST") return this.create(body);
      const id = segments[1] ?? "";
      if (segments.length === 2 && method === "GET") return this.read(id);
      if (segments.length === 2 && method === "PUT") return this.put(id, body);
      if (segments.length === 2 && method === "DELETE") return this.softDelete(id);
      if (segments[2] === "restore" && method === "POST") return this.restore(id);
      if (segments[2] === "lessons" && method === "GET") return this.seriesLessons(id);
    }
    if (segments[0] === "lessons" && segments.length === 1 && method === "POST") {
      return this.createLesson(body);
    }
    if (segments[0] === "jobs" && segments[2] === "cancel" && method === "POST") {
      return json(202, { status: "cancelled" });
    }
    if (
      segments[0] === "lessons" &&
      (segments[2] === "cascade" || segments[2] === "regenerate") &&
      method === "POST"
    ) {
      return this.enqueueProposal(segments[1] ?? "");
    }
    if (segments[0] === "images" && segments[1] === "search" && method === "GET") {
      return this.searchImages();
    }
    if (segments[0] === "images" && segments[1] === "pick" && method === "POST") {
      return this.pickImage(body);
    }
    if (segments[0] === "images" && segments[1] === "report" && method === "POST") {
      return new Response(null, { status: 204 });
    }
    return error(404, "not_found", `fake api: no route for ${method} ${path}`);
  }

  private list(query: URLSearchParams): Response {
    const kind = query.get("kind") as DocumentKind;
    const sort = query.get("sort") ?? "updated";
    const q = (query.get("q") ?? "").trim().toLowerCase();
    const limit = Number(query.get("limit") ?? PAGE_DEFAULT);
    const offset = Number(query.get("cursor") ?? 0);
    const rows = this.live(kind).filter((row) => {
      if (q === "") return true;
      const s = summarise(row.body);
      return s.title.toLowerCase().includes(q) || (s.subject ?? "").toLowerCase().includes(q);
    });
    rows.sort((a, b) => {
      if (sort === "title")
        return a.body.title.localeCompare(b.body.title) || a.id.localeCompare(b.id);
      if (sort === "created")
        return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
      return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
    });
    const page = rows.slice(offset, offset + limit);
    const nextCursor = offset + limit < rows.length ? String(offset + limit) : null;
    return json(200, { items: page.map(summaryJson), nextCursor });
  }

  private insert(kind: DocumentKind, body: Body, generatingJobId: string | null = null): FakeRow {
    const id = newId();
    const now = new Date().toISOString();
    const row: FakeRow = {
      id,
      kind,
      body: { ...structuredClone(body), id },
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      generatingJobId,
    };
    this.rows.set(id, row);
    return row;
  }

  private create(input: unknown): Response {
    const { kind, body } = (input ?? {}) as { kind?: DocumentKind; body?: Body };
    if (!kind || !body)
      return error(400, "validation_failed", "Invalid body.", { fields: ["body"] });
    return json(201, { document: documentJson(this.insert(kind, body)) });
  }

  private read(id: string): Response {
    const row = this.rows.get(id);
    if (!row) return error(404, "not_found", "That document does not exist.");
    return json(200, { document: documentJson(row) });
  }

  private put(id: string, input: unknown): Response {
    const row = this.rows.get(id);
    if (!row) return error(404, "not_found", "That document does not exist.");
    const { document, expectedUpdatedAt } = (input ?? {}) as {
      document?: Body;
      expectedUpdatedAt?: string;
    };
    if (!document || document.id !== id) {
      return error(422, "unprocessable", "The document id does not match the URL.");
    }
    if (row.generatingJobId !== null) {
      return error(409, "conflict", "This lesson is still being generated.", {
        reason: "generating",
      });
    }
    if (expectedUpdatedAt !== row.updatedAt) {
      return error(409, "conflict", "This document changed elsewhere. Reload to continue.", {
        reason: "stale",
      });
    }
    row.body = structuredClone(document);
    row.updatedAt = nextStamp(row.updatedAt);
    return json(200, { document: documentJson(row) });
  }

  private softDelete(id: string): Response {
    const row = this.rows.get(id);
    if (!row) return error(404, "not_found", "That document does not exist.");
    if (row.deletedAt === null) {
      row.deletedAt = new Date().toISOString();
      row.updatedAt = nextStamp(row.updatedAt);
    }
    return json(204, null);
  }

  private restore(id: string): Response {
    const row = this.rows.get(id);
    if (!row) return error(404, "not_found", "That document does not exist.");
    if (row.deletedAt !== null) {
      row.deletedAt = null;
      row.updatedAt = nextStamp(row.updatedAt);
    }
    return json(200, { document: documentJson(row) });
  }

  private seriesLessons(id: string): Response {
    const row = this.rows.get(id);
    if (row?.kind !== "series") return error(404, "not_found", "That document does not exist.");
    const lessons = (row.body as Series).lessonIds.flatMap((lessonId) => {
      const lesson = this.rows.get(lessonId);
      return lesson && lesson.kind === "lesson" && lesson.deletedAt === null
        ? [summaryJson(lesson)]
        : [];
    });
    return json(200, { series: documentJson(row), lessons });
  }

  /** `POST /lessons/:id/{cascade,regenerate}`: a job id, or the api's two 409s. */
  private enqueueProposal(id: string): Response {
    const row = this.rows.get(id);
    if (row?.kind !== "lesson") {
      return error(404, "not_found", "That document does not exist.");
    }
    if (row.generatingJobId !== null) {
      return error(409, "conflict", "This lesson is still being generated.", {
        reason: "generating",
      });
    }
    const jobId = this.nextProposalJobId ?? newId();
    this.nextProposalJobId = null;
    return json(202, { jobId });
  }

  /** When set, the next proposal job gets this id (so a test can drive its fake EventSource). */
  nextProposalJobId: string | null = null;

  private createLesson(input: unknown): Response {
    const jobId = newId();
    const lesson = lessonFromBrief(
      input as Parameters<typeof lessonFromBrief>[0],
      newId(),
      new Date(),
    );
    const row = this.insert("lesson", lesson, jobId);
    return json(202, { lessonId: row.id, jobId });
  }
}

/**
 * Point the RPC client at a fresh `FakeApi` for the rest of the test file. Returns the fake for
 * assertions and the restore function for `afterAll`.
 */
export function installFakeApi(): { fakeApi: FakeApi; restore: () => void } {
  const fakeApi = new FakeApi();
  const original = globalThis.fetch;
  globalThis.fetch = fakeApi.fetch as typeof fetch;
  return {
    fakeApi,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
