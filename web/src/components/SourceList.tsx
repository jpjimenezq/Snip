"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SourceWithCount } from "@/lib/types";
import { formatRelative } from "@/lib/time";
import { PlatformBadge, ProgressBar, StatusChip } from "./Badges";

export function SourceList() {
  const [sources, setSources] = useState<SourceWithCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await createClient()
      .from("sources")
      .select("*, clips(count)")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setSources(data as SourceWithCount[]);
    }
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
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "sources" }, schedule)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clips" }, schedule)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "clips" }, schedule)
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [load]);

  if (error) return <p className="text-sm text-red-400">No se pudieron cargar las fuentes: {error}</p>;
  if (!sources) return <p className="text-sm text-zinc-500">Cargando...</p>;
  if (sources.length === 0)
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
        Aún no hay fuentes. Pega un enlace arriba para empezar.
      </div>
    );

  return (
    <ul className="space-y-3">
      {sources.map((s) => {
        const count = s.clips?.[0]?.count ?? 0;
        const working = !["ready", "error"].includes(s.status);
        return (
          <li key={s.id}>
            <Link
              href={`/sources/${s.id}`}
              className="block rounded-xl border border-white/10 bg-surface p-4 transition hover:border-accent/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PlatformBadge platform={s.platform} />
                <StatusChip status={s.status} kind="source" />
                <span className="ml-auto text-xs text-zinc-500">
                  {count} {count === 1 ? "clip" : "clips"} · {formatRelative(s.created_at)}
                </span>
              </div>
              <p className="mt-2 truncate font-medium">{s.title || s.url}</p>
              {s.title && <p className="truncate text-xs text-zinc-500">{s.url}</p>}
              {working && (
                <div className="mt-3">
                  <ProgressBar value={s.progress} />
                </div>
              )}
              {s.error && <p className="mt-2 line-clamp-2 text-sm text-red-400">{s.error}</p>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
