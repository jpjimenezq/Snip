import { createClient } from "@/lib/supabase/client";
import type { JobType } from "@/lib/types";
import { detectPlatform } from "@/lib/url";

async function currentUserId(): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Sesión expirada. Vuelve a iniciar sesión.");
  return data.user.id;
}

export async function createJob(type: JobType, payload: Record<string, unknown>): Promise<void> {
  const supabase = createClient();
  const user_id = await currentUserId();
  const { error } = await supabase.from("jobs").insert({ user_id, type, payload });
  if (error) throw new Error(error.message);
}

/** Crea la fuente (status queued) y el job process_source. Devuelve el id de la fuente. */
export async function createSourceFromUrl(url: string): Promise<string> {
  const supabase = createClient();
  const user_id = await currentUserId();
  const { data, error } = await supabase
    .from("sources")
    .insert({ user_id, url, platform: detectPlatform(url), status: "queued" })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "No se pudo crear la fuente");
  const source_id = (data as { id: string }).id;
  const { error: jobErr } = await supabase
    .from("jobs")
    .insert({ user_id, type: "process_source", payload: { source_id } });
  if (jobErr) throw new Error(jobErr.message);
  return source_id;
}
