import { SourceList } from "@/components/SourceList";
import { UrlForm } from "@/components/UrlForm";

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-3 text-2xl font-bold tracking-tight">Convierte un video en clips</h1>
        <UrlForm />
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Fuentes</h2>
        <SourceList />
      </section>
    </div>
  );
}
