// Tipos y utilidades de la fase 4 (publicación). Refleja supabase/migrations/0002_live_publish.sql.
import type { Clip, Copies } from "@/lib/types";

export type SocialPlatform = "youtube" | "tiktok" | "instagram" | "facebook";
export type AccountStatus = "connected" | "expired" | "error";
export type PublicationStatus = "queued" | "uploading" | "processing" | "published" | "error";
export type Privacy = "public" | "unlisted" | "private";

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: SocialPlatform;
  external_id: string;
  name: string;
  avatar_url: string | null;
  status: AccountStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Publication {
  id: string;
  user_id: string;
  clip_id: string;
  account_id: string;
  platform: SocialPlatform;
  status: PublicationStatus;
  progress: number;
  title: string | null;
  caption: string | null;
  privacy: Privacy;
  external_id: string | null;
  external_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const SOCIAL_PLATFORMS: { id: SocialPlatform; label: string; hint: string }[] = [
  { id: "youtube", label: "YouTube", hint: "Shorts (canal)" },
  { id: "tiktok", label: "TikTok", hint: "Sin auditoría, solo privado o bandeja" },
  { id: "instagram", label: "Instagram", hint: "Reels (cuenta profesional ligada a una página)" },
  { id: "facebook", label: "Facebook", hint: "Reels en páginas" },
];

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
};

export const PRIVACY_LABEL: Record<Privacy, string> = {
  public: "Público",
  unlisted: "No listado",
  private: "Privado",
};

export const PUBLICATION_LABEL: Record<PublicationStatus, string> = {
  queued: "En cola",
  uploading: "Subiendo",
  processing: "Procesando",
  published: "Publicado",
  error: "Error",
};

/** Texto editable por plataforma (título solo en YouTube). */
export interface PlatformText {
  title: string;
  caption: string;
}

const joinTags = (tags?: string[]) =>
  (tags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");

/** Prellena título/caption de cada plataforma desde clip.copies. */
export function defaultTexts(clip: Pick<Clip, "title" | "hook" | "copies">): Record<SocialPlatform, PlatformText> {
  const c: Copies = clip.copies ?? {};
  const fallback = clip.title || clip.hook || "";
  const withTags = (caption?: string, tags?: string[]) =>
    [caption ?? fallback, joinTags(tags)].filter(Boolean).join("\n\n");
  return {
    youtube: { title: c.youtube?.title ?? fallback, caption: c.youtube?.description ?? "" },
    tiktok: { title: "", caption: withTags(c.tiktok?.caption, c.tiktok?.hashtags) },
    instagram: { title: "", caption: withTags(c.instagram?.caption, c.instagram?.hashtags) },
    facebook: { title: "", caption: c.facebook?.caption ?? fallback },
  };
}

export function isActivePublication(p: Pick<Publication, "status">): boolean {
  return p.status === "queued" || p.status === "uploading" || p.status === "processing";
}
