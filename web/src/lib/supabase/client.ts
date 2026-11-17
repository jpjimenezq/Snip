import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";

let client: SupabaseClient | null = null;

// Valores de respaldo para que el build no falle sin variables de entorno.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

/** Modo demo: datos de ejemplo en memoria, sin Supabase ni login (npm run dev:demo). */
export const IS_DEMO = process.env.NEXT_PUBLIC_SNIP_DEMO === "1";

export function createClient(): SupabaseClient {
  if (!client) {
    client = IS_DEMO
      ? (createDemoClient() as unknown as SupabaseClient)
      : createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return client;
}
