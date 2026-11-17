"use client";

import { useState } from "react";
import type { Copies } from "@/lib/types";

type Net = "youtube" | "tiktok" | "instagram" | "facebook";
const NETS: { id: Net; label: string }[] = [
  { id: "youtube", label: "YouTube" },
  { id: "tiktok", label: "TikTok" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
];

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* sin permiso de portapapeles */
    }
  }
  return (
    <button type="button" onClick={copy} className="btn btn-ghost btn-sm min-h-10 text-xs">
      {done ? "Copiado" : "Copiar"}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
}) {
  const cls = "field";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between">
        <label className="text-xs text-muted">{label}</label>
        <CopyButton text={value} />
      </div>
      {multiline ? (
        <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </div>
  );
}

const splitList = (s: string) => s.split(/[\s,]+/).filter(Boolean);

/** Campo de lista (tags/hashtags): conserva el texto tal cual se escribe y emite el arreglo. */
function ListField({
  label,
  value,
  onChange,
  prefix,
}: {
  label: string;
  value: string[] | undefined;
  onChange: (v: string[]) => void;
  prefix?: string;
}) {
  const [text, setText] = useState((value ?? []).join(prefix ? " " : ", "));
  return (
    <Field
      label={label}
      value={text}
      onChange={(t) => {
        setText(t);
        onChange(splitList(t).map((x) => (prefix && !x.startsWith(prefix) ? prefix + x : x)));
      }}
    />
  );
}

export function CopiesEditor({ copies, onChange }: { copies: Copies; onChange: (c: Copies) => void }) {
  const [tab, setTab] = useState<Net>("youtube");
  const yt = copies.youtube ?? {};
  const tt = copies.tiktok ?? {};
  const ig = copies.instagram ?? {};
  const fb = copies.facebook ?? {};

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="group" aria-label="Red social">
        {NETS.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => setTab(n.id)}
            aria-pressed={tab === n.id}
            className="chip min-h-10 shrink-0"
          >
            {n.label}
          </button>
        ))}
      </div>
      {tab === "youtube" && (
        <div className="space-y-3">
          <Field label="Título" value={yt.title ?? ""} onChange={(v) => onChange({ ...copies, youtube: { ...yt, title: v } })} />
          <Field label="Descripción" multiline rows={5} value={yt.description ?? ""} onChange={(v) => onChange({ ...copies, youtube: { ...yt, description: v } })} />
          <ListField label="Tags (separados por coma)" value={yt.tags} onChange={(v) => onChange({ ...copies, youtube: { ...yt, tags: v } })} />
        </div>
      )}
      {tab === "tiktok" && (
        <div className="space-y-3">
          <Field label="Caption" multiline value={tt.caption ?? ""} onChange={(v) => onChange({ ...copies, tiktok: { ...tt, caption: v } })} />
          <ListField label="Hashtags" prefix="#" value={tt.hashtags} onChange={(v) => onChange({ ...copies, tiktok: { ...tt, hashtags: v } })} />
        </div>
      )}
      {tab === "instagram" && (
        <div className="space-y-3">
          <Field label="Caption" multiline value={ig.caption ?? ""} onChange={(v) => onChange({ ...copies, instagram: { ...ig, caption: v } })} />
          <ListField label="Hashtags" prefix="#" value={ig.hashtags} onChange={(v) => onChange({ ...copies, instagram: { ...ig, hashtags: v } })} />
        </div>
      )}
      {tab === "facebook" && (
        <Field label="Caption" multiline value={fb.caption ?? ""} onChange={(v) => onChange({ ...copies, facebook: { ...fb, caption: v } })} />
      )}
    </div>
  );
}
