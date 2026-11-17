// Cliente falso de Supabase para el modo demo. Implementa solo lo que usa la app:
// from().select/eq/order/insert/update/single/maybeSingle, channel().on().subscribe(),
// removeChannel, auth.getUser/signOut/signInWithPassword y storage.createSignedUrl.
// Los datos viven en memoria (se reinician al recargar) y los "jobs" se simulan.
import type { Clip, Source } from "@/lib/types";
import {
  DEMO_USER_ID,
  MEDIA,
  demoSegmentsFor,
  demoSuggestions,
  initialDemoState,
  makeClip,
  makeCopies,
} from "./data";

type Row = Record<string, unknown>;
type Table = string;
type Event = "INSERT" | "UPDATE" | "DELETE";

const store = initialDemoState() as unknown as Record<Table, Row[]>;
// Cualquier tabla nueva existe vacía en la demo.
const db = new Proxy(store, {
  get: (target, key: string) => (target[key] ??= []),
});
const clone = <T,>(v: T): T => structuredClone(v);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// ---------- realtime ----------
interface Listener {
  channel: object;
  table: string;
  event: string;
  filter?: { col: string; val: string };
  cb: (p: { eventType: Event; new: Row; old: Row }) => void;
}
let listeners: Listener[] = [];

function emit(table: Table, eventType: Event, row: Row, old: Row = {}) {
  for (const l of listeners) {
    if (l.table !== table || (l.event !== "*" && l.event !== eventType)) continue;
    if (l.filter && String(row[l.filter.col] ?? old[l.filter.col]) !== l.filter.val) continue;
    l.cb({ eventType, new: clone(row), old: clone(old) });
  }
}

function insertRow(table: Table, row: Row): Row {
  const full: Row = { id: crypto.randomUUID(), created_at: nowIso(), updated_at: nowIso(), ...row };
  db[table].push(full);
  emit(table, "INSERT", full);
  if (table === "jobs") void runJob(full);
  return full;
}

function updateRow(table: Table, id: string, patch: Row): Row | undefined {
  const row = db[table].find((r) => r.id === id);
  if (!row) return undefined;
  const old = clone(row);
  Object.assign(row, patch, { updated_at: nowIso() });
  emit(table, "UPDATE", row, old);
  return row;
}

/** Borra una fila y, como la BD real, sus dependientes en cascada. */
function deleteRow(table: Table, row: Row) {
  const id = row.id ?? row.source_id;
  const key = table === "transcripts" ? "source_id" : "id";
  store[table] = db[table].filter((r) => r[key] !== row[key]);
  emit(table, "DELETE", {}, row);
  if (table === "sources") {
    for (const c of db.clips.filter((c) => c.source_id === id)) deleteRow("clips", c);
    for (const t of db.transcripts.filter((t) => t.source_id === id)) deleteRow("transcripts", t);
  }
  if (table === "clips") {
    for (const p of db.publications.filter((p) => p.clip_id === id)) deleteRow("publications", p);
  }
}

// ---------- query builder ----------
type Filter = (r: Row) => boolean;

class Query implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = [];
  private orderBy?: { col: string; asc: boolean };
  private max?: number;
  private mode: "many" | "single" | "maybe" = "many";
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload?: Row | Row[];
  private cols = "*";

  constructor(private table: Table) {}

  select(cols = "*") {
    this.cols = cols;
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => String(r[col]) >= String(val));
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  upsert(rows: Row | Row[]) {
    this.op = "upsert";
    this.payload = rows;
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true };
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = rows;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private run(): unknown {
    let rows: Row[];
    if (this.op === "insert" || this.op === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      rows = list.map((r) =>
        this.op === "upsert" && r.id && db[this.table].some((x) => x.id === r.id)
          ? updateRow(this.table, r.id as string, r)!
          : insertRow(this.table, r),
      );
    } else {
      rows = db[this.table].filter((r) => this.filters.every((f) => f(r)));
      if (this.op === "update") {
        rows = rows.map((r) => updateRow(this.table, r.id as string, this.payload as Row)!);
      }
      if (this.op === "delete") {
        for (const r of rows) deleteRow(this.table, r);
      }
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    if (this.max !== undefined) rows = rows.slice(0, this.max);
    let out = clone(rows);
    if (this.table === "sources" && this.cols.includes("clips(count)")) {
      out = out.map((s) => ({ ...s, clips: [{ count: db.clips.filter((c) => c.source_id === s.id).length }] }));
    }
    if (this.mode === "many") return out;
    return out[0] ?? null;
  }

  then<A = { data: unknown; error: null }, B = never>(
    ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null,
    fail?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => ({ data: this.run(), error: null as null }))
      .then(ok, fail);
  }
}

// ---------- simulación de jobs ----------
async function runJob(job: Row) {
  const payload = (job.payload ?? {}) as Row;
  await sleep(600);
  updateRow("jobs", job.id as string, { status: "running" });
  try {
    if (job.type === "render_clip") await simRender(payload.clip_id as string);
    if (job.type === "generate_copy") await simCopy(payload.clip_id as string);
    if (job.type === "manual_clip") await simManual(payload as { source_id: string; at_s: number; duration_s: number });
    if (job.type === "process_source") await simProcess(payload.source_id as string, payload.force_analysis === true);
    if (job.type === "publish_clip") await simPublish(payload.publication_ids as string[]);
    if (job.type === "live_clip") await simLive(payload as { url: string; duration_s: number }, job.user_id as string);
    updateRow("jobs", job.id as string, { status: "done" });
  } catch (e) {
    updateRow("jobs", job.id as string, { status: "error", error: String(e) });
  }
}

async function simRender(clipId: string) {
  updateRow("clips", clipId, { status: "rendering", progress: 0 });
  for (let p = 0.1; p < 1; p += 0.15) {
    await sleep(500);
    updateRow("clips", clipId, { progress: Math.min(p, 0.95) });
  }
  await sleep(400);
  updateRow("clips", clipId, { status: "rendered", progress: 1, output_path: MEDIA.final });
}

function channelOf(sourceId: string): string {
  const s = db.sources.find((r) => r.id === sourceId) as Source | undefined;
  return s?.channel ?? "el canal";
}

async function simCopy(clipId: string) {
  await sleep(1500);
  const c = db.clips.find((r) => r.id === clipId) as Clip | undefined;
  if (!c) return;
  updateRow("clips", clipId, { copies: makeCopies(c.title ?? "Clip del directo", channelOf(c.source_id)) });
}

async function simManual(p: { source_id: string; at_s: number; duration_s: number }) {
  await sleep(1000);
  const start = Math.max(0, p.at_s - p.duration_s);
  const t = new Date(p.at_s * 1000).toISOString().slice(11, 19);
  const clip = makeClip({
    id: crypto.randomUUID(), source_id: p.source_id, start_s: start, end_s: p.at_s,
    origin: "manual", title: `Clip manual ${t}`, created_at: nowIso(), updated_at: nowIso(),
  });
  insertRow("clips", clip as unknown as Row);
  await simCopy(clip.id);
}

async function simPublish(ids: string[] = []) {
  await Promise.all(
    ids.map(async (id, i) => {
      await sleep(400 * i);
      updateRow("publications", id, { status: "uploading", progress: 0 });
      for (let p = 0.2; p <= 1; p += 0.2) {
        await sleep(450);
        updateRow("publications", id, { progress: p });
      }
      updateRow("publications", id, { status: "processing", progress: 1 });
      await sleep(900);
      const ext = Math.random().toString(36).slice(2, 12);
      updateRow("publications", id, {
        status: "published",
        external_id: ext,
        // En la demo no hay enlace real: evitar mandar a páginas inexistentes.
        external_url: null,
      });
    }),
  );
}

async function simLive(p: { url: string; duration_s: number }, userId: string) {
  const watch = db.live_watches.find((w) => w.url === p.url);
  const channel = String(watch?.channel ?? p.url.split("/").pop());
  const hhmm = new Date().toTimeString().slice(0, 5);
  const src = insertRow("sources", {
    user_id: userId, url: p.url, platform: watch?.platform ?? "kick", title: `En vivo · ${channel} · ${hhmm}`,
    channel, duration_s: p.duration_s, status: "transcribing", progress: 0.5, error: null,
    local_path: null, thumb_path: MEDIA.thumb,
  });
  await sleep(1500);
  updateRow("sources", src.id as string, { status: "ready", progress: 1 });
  const clip = makeClip({
    id: crypto.randomUUID(), source_id: src.id as string, start_s: 0, end_s: p.duration_s,
    origin: "hotkey", title: `Clip en vivo de ${channel}`, created_at: nowIso(), updated_at: nowIso(),
  });
  insertRow("clips", clip as unknown as Row);
  await simCopy(clip.id);
}

const running = new Set<string>();
async function simProcess(sourceId: string, force = false) {
  if (running.has(sourceId)) return;
  const s = db.sources.find((r) => r.id === sourceId) as Source | undefined;
  if (!s) return;
  running.add(sourceId);
  const isYt = s.platform === "youtube";
  if (!s.title) {
    updateRow("sources", sourceId, {
      title: isYt ? "Video de YouTube (demo)" : "Directo completo (demo)",
      channel: isYt ? "Canal YouTube Demo" : "Canal Demo",
      duration_s: isYt ? 600 : 2 * 3600 + 40 * 60,
      thumb_path: MEDIA.thumb,
    });
  }
  const steps: [Source["status"], number][] = [["downloading", 6], ["transcribing", 8], ["analyzing", 4]];
  // force_analysis: solo repite el análisis y reemplaza las sugerencias de la IA
  // (los clips manuales, de atajo o ya renderizados se conservan).
  if (force) {
    for (const c of db.clips.filter((c) => c.source_id === sourceId && c.origin === "ai" && c.status === "suggested")) {
      deleteRow("clips", c);
    }
  }
  const firstStep = force ? 2 : Math.max(0, steps.findIndex(([st]) => st === s.status));
  for (const [status, n] of steps.slice(firstStep)) {
    const cur = db.sources.find((r) => r.id === sourceId) as unknown as Source;
    let p = status === cur.status && !force ? cur.progress : 0;
    updateRow("sources", sourceId, { status, progress: p });
    while (p < 1) {
      await sleep(700);
      p = Math.min(1, p + 1 / n);
      updateRow("sources", sourceId, { progress: p });
    }
  }
  const done = db.sources.find((r) => r.id === sourceId) as unknown as Source;
  const duration = done.duration_s ?? 600;
  if (!db.transcripts.some((t) => t.source_id === sourceId)) {
    const segments = demoSegmentsFor(duration);
    db.transcripts.push({ source_id: sourceId, language: "es", text: segments.map((x) => x.text).join(" "), segments, created_at: nowIso() });
  }
  for (const c of demoSuggestions(sourceId, duration, done.channel ?? "el canal")) {
    insertRow("clips", c as unknown as Row);
    await sleep(300);
  }
  updateRow("sources", sourceId, { status: "ready", progress: 1 });
  running.delete(sourceId);
}

// Las fuentes que arrancan "a medio procesar" siguen avanzando solas.
if (typeof window !== "undefined") {
  for (const s of db.sources) {
    if (!["ready", "error"].includes(s.status as string)) void simProcess(s.id as string);
  }
}

// ---------- cliente ----------
function parseFilter(f?: string) {
  const m = f?.match(/^(\w+)=eq\.(.+)$/);
  return m ? { col: m[1], val: m[2] } : undefined;
}

export function createDemoClient() {
  return {
    from: (table: Table) => new Query(table),
    channel() {
      const ch = {
        on(_type: string, opts: { event: string; table: string; filter?: string }, cb: Listener["cb"]) {
          listeners.push({ channel: ch, table: opts.table, event: opts.event, filter: parseFilter(opts.filter), cb });
          return ch;
        },
        subscribe() {
          return ch;
        },
      };
      return ch;
    },
    rpc: async () => ({ data: null, error: null }),
    removeChannel(ch: object) {
      listeners = listeners.filter((l) => l.channel !== ch);
      return Promise.resolve("ok");
    },
    auth: {
      getUser: async () => ({ data: { user: { id: DEMO_USER_ID, email: "demo@snip.local" } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: path }, error: null }),
      }),
    },
  };
}
