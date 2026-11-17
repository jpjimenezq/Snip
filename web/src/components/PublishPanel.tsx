"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Clip } from "@/lib/types";
import {
  PLATFORM_LABEL,
  PRIVACY_LABEL,
  PUBLICATION_LABEL,
  SOCIAL_PLATFORMS,
  defaultTexts,
  isActivePublication,
  type PlatformText,
  type Privacy,
  type Publication,
  type SocialAccount,
  type SocialPlatform,
} from "@/lib/publish";

const inputCls = "w-full rounded-lg border border-white/10 bg-bg px-3 py-2 text-sm outline-none focus:border-accent";

function PubStatus({ p }: { p: Publication }) {
  const tone =
    p.status === "published"
      ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
      : p.status === "error"
        ? "bg-red-500/15 text-red-300 ring-red-500/30"
        : p.status === "queued"
          ? "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30"
          : "bg-amber-500/15 text-amber-300 ring-amber-500/30";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {PUBLICATION_LABEL[p.status]}
      {(p.status === "uploading" || p.status === "processing") && ` ${Math.round(p.progress * 100)}%`}
    </span>
  );
}

export function PublishPanel({ clip, onPublished }: { clip: Clip; onPublished?: () => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [texts, setTexts] = useState<Record<SocialPlatform, PlatformText>>(() => defaultTexts(clip));
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clipId = clip.id;

  const loadPubs = useCallback(async () => {
    const { data } = await createClient()
      .from("publications")
      .select("*")
      .eq("clip_id", clipId)
      .order("created_at", { ascending: false });
    setPubs((data as Publication[]) ?? []);
  }, [clipId]);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    (async () => {
      const { data } = await supabase.from("social_accounts").select("*").order("created_at", { ascending: true });
      if (!alive) return;
      setAccounts((data as SocialAccount[]) ?? []);
      await loadPubs();
      if (alive) setLoading(false);
    })();
    const channel = supabase
      .channel(`publications-${clipId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "publications", filter: `clip_id=eq.${clipId}` }, () =>
        loadPubs(),
      )
      .subscribe();
    return () => {
      alive = false;
      supabase.removeChannel(channel);
    };
  }, [clipId, loadPubs]);

  const usable = useMemo(() => accounts.filter((a) => a.status === "connected"), [accounts]);
  const allSelected = usable.length > 0 && usable.every((a) => selected.has(a.id));
  const selectedAccounts = usable.filter((a) => selected.has(a.id));
  const platformsSelected = SOCIAL_PLATFORMS.filter((p) => selectedAccounts.some((a) => a.platform === p.id));
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "Cuenta eliminada";

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const setText = (p: SocialPlatform, patch: Partial<PlatformText>) =>
    setTexts((prev) => ({ ...prev, [p]: { ...prev[p], ...patch } }));

  async function publish() {
    setError(null);
    if (selectedAccounts.length === 0) return;
    setSending(true);
    try {
      const supabase = createClient();
      const rows = selectedAccounts.map((a) => {
        const t = texts[a.platform];
        return {
          user_id: clip.user_id,
          clip_id: clipId,
          account_id: a.id,
          platform: a.platform,
          status: "queued",
          title: a.platform === "youtube" ? t.title.trim() || clip.title || "Clip" : null,
          caption: t.caption.trim(),
          privacy,
        };
      });
      const { data, error: err } = await supabase.from("publications").insert(rows).select("id");
      if (err || !data) throw new Error(err?.message ?? "No se pudieron crear las publicaciones");
      const { error: jobErr } = await supabase.from("jobs").insert({
        user_id: clip.user_id,
        type: "publish_clip",
        payload: { publication_ids: data.map((r: { id: string }) => r.id) },
      });
      if (jobErr) throw new Error(jobErr.message);
      setSelected(new Set());
      await loadPubs();
      onPublished?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al publicar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      {clip.status !== "rendered" && (
        <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-300 ring-1 ring-sky-500/30">
          Este clip aún no está renderizado: el worker lo renderizará primero y luego publicará (tu PC debe estar
          encendida con el worker corriendo).
        </p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Cargando cuentas…</p>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 p-4 text-sm text-zinc-400">
          No tienes cuentas conectadas.{" "}
          <Link href="/settings" className="text-accent underline">
            Conectar cuentas
          </Link>
        </div>
      ) : (
        <>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-zinc-400">Publicar en</span>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={usable.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(usable.map((a) => a.id)))}
                />
                Todas
              </label>
            </div>
            <ul className="space-y-1">
              {accounts.map((a) => {
                const disabled = a.status !== "connected";
                return (
                  <li key={a.id}>
                    <label
                      className={`flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer hover:bg-white/10"}`}
                    >
                      <input type="checkbox" disabled={disabled} checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                      <span className="w-20 shrink-0 text-xs text-zinc-400">{PLATFORM_LABEL[a.platform]}</span>
                      <span className="min-w-0 flex-1 truncate">{a.name}</span>
                      {disabled && (
                        <Link href="/settings" className="text-xs text-amber-300 underline">
                          {a.status === "expired" ? "Expirada: reconectar" : "Con error"}
                        </Link>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>

          {platformsSelected.map((p) => (
            <div key={p.id} className="space-y-2 rounded-lg border border-white/10 p-3">
              <div className="text-xs font-medium text-zinc-300">{p.label}</div>
              {p.id === "youtube" && (
                <input
                  className={inputCls}
                  placeholder="Título"
                  maxLength={100}
                  value={texts.youtube.title}
                  onChange={(e) => setText("youtube", { title: e.target.value })}
                />
              )}
              <textarea
                className={inputCls}
                rows={p.id === "youtube" ? 4 : 3}
                placeholder={p.id === "youtube" ? "Descripción" : "Caption"}
                value={texts[p.id].caption}
                onChange={(e) => setText(p.id, { caption: e.target.value })}
              />
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs text-zinc-400">Privacidad</span>
              <select value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)} className="rounded-lg border border-white/10 bg-bg px-2 py-2.5 text-sm">
                {(Object.keys(PRIVACY_LABEL) as Privacy[]).map((k) => (
                  <option key={k} value={k}>
                    {PRIVACY_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={publish}
              disabled={sending || selectedAccounts.length === 0}
              className="ml-auto h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {sending ? "Encolando…" : `Publicar${selectedAccounts.length ? ` (${selectedAccounts.length})` : ""}`}
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            TikTok sin auditoría de la app solo admite privado o enviar el video a tu bandeja para terminar de publicar.
            Instagram solo admite público; Facebook: &quot;Privado&quot; guarda un borrador.
          </p>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </>
      )}

      {pubs.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs text-zinc-400">Historial de publicaciones</h3>
          <ul className="space-y-2">
            {pubs.map((p) => (
              <li key={p.id} className="rounded-lg bg-white/5 p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">{PLATFORM_LABEL[p.platform]}</span>
                  <span className="min-w-0 flex-1 truncate">{accountName(p.account_id)}</span>
                  <PubStatus p={p} />
                  {p.external_url && (
                    <a href={p.external_url} target="_blank" rel="noreferrer" className="text-xs text-accent underline">
                      Abrir
                    </a>
                  )}
                </div>
                {isActivePublication(p) && p.status !== "queued" && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
                    <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(p.progress * 100)}%` }} />
                  </div>
                )}
                {p.error && (
                  <p className={`mt-1 text-xs ${p.status === "error" ? "text-red-300" : "text-amber-300"}`}>{p.error}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
