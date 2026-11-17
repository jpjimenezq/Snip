"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

export interface PlayerHandle {
  seekTo: (seconds: number) => void;
}

export const YouTubePlayer = forwardRef<PlayerHandle, { videoId: string }>(function YouTubePlayer(
  { videoId },
  ref,
) {
  const iframe = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(ref, () => ({
    seekTo(seconds: number) {
      iframe.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
        "*",
      );
      iframe.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
        "*",
      );
      iframe.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  }));
  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-line bg-black">
      <iframe
        ref={iframe}
        className="h-full w-full"
        src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0`}
        title="Reproductor de YouTube"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
});
