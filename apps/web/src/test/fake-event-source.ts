/**
 * Minimal `EventSource` double for tests. Install with `globalThis.EventSource = FakeEventSource`
 * and drive it with `FakeEventSource.latest.emit("progress", payload)`.
 */
export class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  static get latest(): FakeEventSource {
    const last = FakeEventSource.instances.at(-1);
    if (!last) throw new Error("no FakeEventSource has been constructed");
    return last;
  }
  static reset(): void {
    FakeEventSource.instances = [];
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readonly url: string;
  readonly withCredentials: boolean;
  readyState = 0;
  closed = false;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    super();
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  /** Emit a named SSE event (`event: <type>`) with a JSON-encoded `data` line. */
  emit(type: string, data: unknown, lastEventId = ""): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    const event = new MessageEvent(type, { data: payload, lastEventId });
    this.dispatchEvent(event);
    if (type === "message") this.onmessage?.(event);
  }

  fail(): void {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
}

export function installFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.reset();
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
  return FakeEventSource;
}
