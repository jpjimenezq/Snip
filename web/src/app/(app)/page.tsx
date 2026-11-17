import { RecentClips } from "@/components/RecentClips";
import { SourceList } from "@/components/SourceList";
import { UrlForm } from "@/components/UrlForm";
import { SectionHeader } from "@/components/ui";

export default function Dashboard() {
  return (
    <div className="space-y-10">
      <section className="mx-auto max-w-3xl pt-2 text-center sm:pt-8">
        <h1 className="font-display text-3xl sm:text-[2.6rem]">Convierte videos largos en clips virales</h1>
        <p className="mx-auto mt-3 max-w-xl text-[0.95rem] text-muted">
          Pega un directo de Kick o Twitch, o un video de YouTube. La IA encuentra los mejores momentos y los deja
          en vertical con subtítulos.
        </p>
        <div className="mt-7 text-left">
          <UrlForm />
        </div>
      </section>
      <RecentClips />
      <section>
        <SectionHeader title="Videos" />
        <SourceList />
      </section>
    </div>
  );
}
