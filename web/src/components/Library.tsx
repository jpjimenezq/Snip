"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Clip, ClipOrigin } from "@/lib/types";
import { ClipCard } from "./ClipCard";

type StatusFilter = "all" | "suggested" | "rendered" | "published";
type OriginFilter = "all" | ClipOrigin;
type Sort = "recent" | "score";

const STATUS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "suggested", label: "Sugeridos" },
  { id: "rendered", label: "Renderizados" },
  { id: "published", label: "Publicados" },
];
const ORIGIN: { id: OriginFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "ai", label: "IA" },
  { id: "manual", label: "Manual" },
  { id: "hotkey", label: "Atajo" },
];

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="hidden shrink-0 text-xs text-zinc-500 sm:block">{label}</span>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            className={`h-10 shrink-0 rounded-full px-3.5 text-sm ${
              value === o.id ? "bg-accent text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Library() {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [origin, setOrigin] = useState<OriginFilter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [c, p, s] = await Promise.all([
      supabase.from("clips").select("*").order("created_at", { ascending: false }),
      supabase.from("publications").select("clip_id").eq("status", "published"),
      supabase.from("sources").select("id, title, url"),
    ]);
    if (c.error) {
      setError(c.error.message);
      return;
    }
    setError(null);
    setClips((c.data as Clip[] | null) ?? []);
    setPublished(new Set(((p.data as { clip_id: string }[] | null) ?? []).map((x) => x.clip_id)));
    const map: Record<string, string | null> = {};
    for (const r of (s.data as { id: string; title: string | null; url: string }[] | null) ?? []) {
      map[r.id] = r.title || r.url;
    }
    setTitles(map);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(load, 400);
    };
    const channel = supabase
      .channel("library")
      .on("postgres_changes", { event: "*", schema: "public", table: "clips" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "publications" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "sources" }, schedule)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const visible = useMemo(() => {
    if (!clips) return [];
    const needle = norm(q.trim());
    const list = clips.filter((c) => {
      if (status === "suggested" && c.status !== "suggested") return false;
      if (status === "rendered" && c.status !== "rendered") return false;
      if (status === "published" && !published.has(c.id)) return false;
      if (origin !== "all" && c.origin !== origin) return false;
      if (needle && !norm(c.title ?? "").includes(needle)) return false;
      return true;
    });
    return list.sort((a, b) =>
      sort === "score"
        ? (b.score ?? -1) - (a.score ?? -1) || b.created_at.localeCompare(a.created_at)
        : b.created_at.localeCompare(a.created_at),
    );
  }, [clips, status, origin, q, sort, published]);

  if (error) return <p className="text-sm text-red-400">No se pudieron cargar los clips: {error}</p>;
  if (!clips) return <p className="text-sm text-zinc-500">Cargando...</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por título..."
            aria-label="Buscar clips por título"
            className="h-11 w-full min-w-0 rounded-lg border border-white/10 bg-surface px-3 sm:flex-1 outline-none focus:border-accent"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Ordenar clips"
            className="h-11 rounded-lg border border-white/10 bg-surface px-3 outline-none focus:border-accent"
          >
            <option value="recent">Más recientes</option>
            <option value="score">Mejor puntaje</option>
          </select>
        </div>
        <Pills label="Estado" value={status} options={STATUS} onChange={setStatus} />
        <Pills label="Origen" value={origin} options={ORIGIN} onChange={setOrigin} />
      </div>

      <p className="text-xs text-zinc-500" aria-live="polite">
        {visible.length} {visible.length === 1 ? "clip" : "clips"}
        {visible.length !== clips.length ? ` de ${clips.length}` : ""}
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">
          {clips.length === 0 ? "Todavía no hay clips. Procesa una fuente para generar sugerencias." : "Ningún clip coincide con los filtros."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
          {visible.map((c) => (
            <ClipCard
              key={c.id}
              clip={c}
              published={published.has(c.id)}
              sourceTitle={titles[c.source_id]}
              onDeleted={(id) => setClips((cs) => cs?.filter((x) => x.id !== id) ?? cs)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
