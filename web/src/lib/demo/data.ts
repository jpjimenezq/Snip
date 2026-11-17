// Datos de ejemplo del modo demo (NEXT_PUBLIC_SNIP_DEMO=1). Nada de esto toca Supabase.
import type { Clip, Copies, Layout, Source, Transcript, TranscriptSegment } from "@/lib/types";

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

export const MEDIA = {
  frame: "/demo/frame.jpg",
  thumb: "/demo/thumb.jpg",
  preview: "/demo/preview.mp4",
  final: "/demo/final.mp4",
};

const now = Date.now();
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

export const SPLIT_LAYOUT: Layout = {
  preset: "split",
  regions: [
    { x: 0.0208, y: 0.037, w: 0.2917, h: 0.3889 },
    { x: 0.3, y: 0, w: 0.6, h: 1 },
  ],
  split_ratio: 0.4,
};

function source(p: Partial<Source> & Pick<Source, "id" | "url" | "platform">): Source {
  return {
    user_id: DEMO_USER_ID,
    title: null,
    channel: null,
    duration_s: null,
    status: "ready",
    progress: 1,
    error: null,
    local_path: null,
    thumb_path: MEDIA.thumb,
    created_at: ago(5),
    updated_at: ago(5),
    ...p,
  };
}

export function makeClip(p: Partial<Clip> & Pick<Clip, "id" | "source_id" | "start_s" | "end_s">): Clip {
  return {
    user_id: DEMO_USER_ID,
    origin: "ai",
    title: null,
    hook: null,
    reason: null,
    score: null,
    layout: null,
    subtitle_style: "karaoke",
    status: "suggested",
    progress: 0,
    error: null,
    frame_path: MEDIA.frame,
    preview_path: MEDIA.preview,
    output_path: null,
    copies: null,
    created_at: ago(4),
    updated_at: ago(4),
    ...p,
  };
}

export function makeCopies(title: string, channel: string): Copies {
  const tag = channel.replace(/\s+/g, "").toLowerCase();
  return {
    youtube: {
      title: `${title} 😳 #shorts`,
      description: `${title}. Momento del directo de ${channel}.\n\nSíguenos para más clips diarios.`,
      tags: [tag, "clips", "stream", "kick", "colombia"],
    },
    tiktok: {
      caption: `${title} 😂 ¿Ustedes qué hubieran hecho?`,
      hashtags: [`#${tag}`, "#clips", "#stream", "#parati", "#colombia"],
    },
    instagram: {
      caption: `${title} 🔥\nClip del directo de ${channel}.`,
      hashtags: [`#${tag}`, "#reels", "#streamer", "#clipsdestream"],
    },
    facebook: { caption: `${title} — no se lo pierdan 👀 (directo de ${channel})` },
  };
}

// ---------- Fuente 1: VOD de Kick, lista ----------
const S1 = "11111111-1111-4111-8111-111111111111";
const CH1 = "Canal Demo";

const S1_CLIPS: Clip[] = [
  makeClip({
    id: "c1000000-0000-4000-8000-000000000001", source_id: S1, start_s: 4335, end_s: 4371, score: 94,
    title: "Se le cae el internet en la final y explota",
    hook: "“No, no, no… ¡justo ahora parce!”",
    reason: "Pico emocional fuerte, reacción genuina y se entiende sin contexto. Ideal para los primeros 3 s.",
    layout: SPLIT_LAYOUT, status: "rendered", progress: 1, output_path: MEDIA.final,
    copies: makeCopies("Se le cae el internet en la final y explota", CH1),
  }),
  makeClip({
    id: "c1000000-0000-4000-8000-000000000002", source_id: S1, start_s: 2710, end_s: 2752, score: 88,
    title: "La jugada imposible que nadie se esperaba",
    hook: "“¿Vieron eso? ¡Repítanla, repítanla!”",
    reason: "Momento de habilidad con reacción del chat al máximo; cierra con un remate gracioso.",
    copies: makeCopies("La jugada imposible que nadie se esperaba", CH1),
  }),
  makeClip({
    id: "c1000000-0000-4000-8000-000000000003", source_id: S1, start_s: 6120, end_s: 6168, score: 81,
    title: "Opinión polémica: “ese jugador está sobrevalorado”",
    hook: "“Lo voy a decir y que se enoje quien se enoje…”",
    reason: "Hot take que genera comentarios y debate; buena retención por la tensión.",
  }),
  makeClip({
    id: "c1000000-0000-4000-8000-000000000004", source_id: S1, start_s: 980, end_s: 1012, score: 76,
    title: "La historia del taxi a las 3 de la mañana",
    hook: "“Les cuento lo que me pasó anoche…”",
    reason: "Historia corta con remate claro al final.",
  }),
  makeClip({
    id: "c1000000-0000-4000-8000-000000000005", source_id: S1, start_s: 8420, end_s: 8445, score: 69,
    title: "Le responde a un donador y el chat enloquece",
    hook: "“¿Cómo así que 50 mil pesos para eso?”",
    reason: "Interacción divertida con la audiencia; algo de contexto necesario.",
  }),
  makeClip({
    id: "c1000000-0000-4000-8000-000000000006", source_id: S1, start_s: 300, end_s: 315, score: null,
    origin: "manual", title: "Clip manual 00:05:15",
  }),
];

const S1_SEGMENTS: TranscriptSegment[] = [
  [300, 315, "bueno bienvenidos todos al directo de hoy, hoy vamos con todo"],
  [980, 996, "les cuento lo que me pasó anoche, cojo un taxi a las tres de la mañana"],
  [996, 1012, "y el señor me dice usted es el del stream, y yo no parce cómo así"],
  [2710, 2730, "vieron eso, repítanla repítanla, eso no es normal"],
  [2730, 2752, "nadie hace esa jugada, nadie, me tienen que dar un premio"],
  [4335, 4352, "no no no justo ahora parce, se me cayó el internet en la final"],
  [4352, 4371, "esto es una locura miren lo que acaba de pasar en el directo"],
  [6120, 6145, "lo voy a decir y que se enoje quien se enoje, ese jugador está sobrevalorado"],
  [6145, 6168, "sí, lo dije, y no me retracto, díganme en el chat si estoy mal"],
  [8420, 8445, "cómo así que cincuenta mil pesos para eso, ustedes están locos, gracias mi rey"],
].map(([start, end, text]) => ({ start: start as number, end: end as number, text: text as string }));

// ---------- Fuente 2: YouTube, transcribiendo (avanza sola en la demo) ----------
const S2 = "22222222-2222-4222-8222-222222222222";

export function initialDemoState() {
  const sources: Source[] = [
    source({
      id: S2, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube",
      title: "Video de YouTube de ejemplo", channel: "Canal YouTube Demo", duration_s: 213,
      status: "transcribing", progress: 0.35, created_at: ago(2), updated_at: ago(1),
    }),
    source({
      id: S1, url: "https://kick.com/canal-demo/videos/ejemplo", platform: "kick",
      title: "Directo completo: final del torneo + charla con el chat", channel: CH1,
      duration_s: 3 * 3600 + 12 * 60, created_at: ago(90), updated_at: ago(60),
    }),
    source({
      id: "33333333-3333-4333-8333-333333333333", url: "https://www.twitch.tv/videos/000000", platform: "twitch",
      title: null, channel: null, status: "error", progress: 0, thumb_path: null,
      error: "No se pudo descargar: el VOD es solo para suscriptores.", created_at: ago(300), updated_at: ago(299),
    }),
  ];
  const transcripts: Transcript[] = [
    { source_id: S1, language: "es", text: S1_SEGMENTS.map((s) => s.text).join(" "), segments: S1_SEGMENTS, created_at: ago(60) },
  ];
  return { sources, clips: [...S1_CLIPS], transcripts, jobs: [] as Record<string, unknown>[] };
}

/** Clips que "la IA" sugiere cuando termina de procesar una fuente en la demo. */
export function demoSuggestions(sourceId: string, duration: number, channel: string): Clip[] {
  const ideas: [string, string, number][] = [
    ["El momento exacto en que todo se sale de control", "“Esperen, esperen… ¿qué acaba de pasar?”", 91],
    ["Reacción épica al final", "“No lo puedo creer, ¡lo logramos!”", 84],
    ["La frase que se volvió meme", "“Eso no es normal, parce”", 72],
  ];
  return ideas.map(([title, hook, score], i) => {
    const start = Math.max(0, Math.round(duration * (0.2 + i * 0.25)));
    return makeClip({
      id: crypto.randomUUID(), source_id: sourceId, start_s: start, end_s: start + 30 + i * 8, score, title, hook,
      reason: "Detectado en la demo: pico de emoción y frase fuerte al inicio.",
      created_at: new Date().toISOString(), copies: makeCopies(title, channel),
    });
  });
}

export function demoSegmentsFor(duration: number): TranscriptSegment[] {
  const lines = ["esperen esperen qué acaba de pasar", "no lo puedo creer lo logramos", "eso no es normal parce"];
  return lines.map((text, i) => {
    const start = Math.round(duration * (0.2 + i * 0.25));
    return { start, end: start + 30, text };
  });
}
