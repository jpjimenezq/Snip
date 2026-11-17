export function LiveExtensionInfo() {
  return (
    <div className="panel p-4 text-sm text-muted">
      <h2 className="mb-2 text-[0.95rem] font-semibold text-foreground">Clips con un atajo</h2>
      <p className="leading-relaxed">
        Instala la extensión de Chrome (carpeta <code className="rounded bg-raised px-1 text-foreground">extension/</code>{" "}
        &gt; Cargar descomprimida) y pulsa <span className="kbd">Alt</span> <span className="kbd">Shift</span>{" "}
        <span className="kbd">S</span> mientras ves un directo: elige 5/10/15/30/45/60 s (teclas{" "}
        <span className="kbd">1</span>–<span className="kbd">6</span>, <span className="kbd">Enter</span> = 30 s). Si
        el canal está en esta lista, el worker corta el tramo del búfer; si no, lo agrega y tendrás que repetir en unos
        segundos. Puedes cambiar el atajo en{" "}
        <code className="rounded bg-raised px-1 text-foreground">chrome://extensions/shortcuts</code>.
      </p>
    </div>
  );
}
