import { LiveExtensionInfo } from "@/components/LiveExtensionInfo";
import { LiveWatches } from "@/components/LiveWatches";

export default function LivePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">En vivo</h1>
      <LiveExtensionInfo />
      <LiveWatches />
    </div>
  );
}
