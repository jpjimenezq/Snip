"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const TTL = 3600;
const cache = new Map<string, { url: string; exp: number }>();

export async function getSignedUrl(path: string, download?: string): Promise<string | null> {
  const key = path + "|" + (download ?? "");
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from("clips")
    .createSignedUrl(path, TTL, download ? { download } : undefined);
  if (error || !data) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + (TTL - 300) * 1000 });
  return data.signedUrl;
}

/** URL firmada del bucket 'clips'. enabled=false difiere la petición. */
export function useSignedUrl(path: string | null | undefined, enabled = true): string | null {
  const [state, setState] = useState<{ path: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!path || !enabled) return;
    let cancelled = false;
    getSignedUrl(path).then((url) => {
      if (!cancelled) setState({ path, url });
    });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return path && state?.path === path ? state.url : null;
}
