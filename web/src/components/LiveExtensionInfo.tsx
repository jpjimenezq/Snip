export function LiveExtensionInfo() {
  return (
    <div className="rounded-xl border border-white/10 bg-surface p-4 text-sm text-zinc-300">
      <h2 className="mb-1 font-semibold text-foreground">Clips con un atajo</h2>
      <p>
        Instala la extensión de Chrome (carpeta <code className="rounded bg-white/10 px-1">extension/</code> &gt; Cargar
        descomprimida) y pulsa <kbd className="rounded bg-white/10 px-1.5 py-0.5">Alt+Shift+S</kbd> mientras ves un
        directo: elige 5/10/15/30/45/60 s (teclas 1–6, Enter = 30 s). Si el canal está en esta lista, el worker corta
        el tramo del búfer; si no, lo agrega y tendrás que repetir en unos segundos. Puedes cambiar el atajo en{" "}
        <code className="rounded bg-white/10 px-1">chrome://extensions/shortcuts</code>.
      </p>
    </div>
  );
}
