import { LiveExtensionInfo } from "@/components/LiveExtensionInfo";
import { LiveWatches } from "@/components/LiveWatches";
import { PageTitle } from "@/components/ui";

export default function LivePage() {
  return (
    <div className="space-y-6">
      <PageTitle title="En vivo">
        Graba canales en un búfer continuo y corta los últimos segundos con un toque.
      </PageTitle>
      <LiveWatches />
      <LiveExtensionInfo />
    </div>
  );
}
