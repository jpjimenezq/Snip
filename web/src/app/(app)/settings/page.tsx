import { AccountsPanel } from "@/components/AccountsPanel";

export const metadata = { title: "Ajustes · Snip" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; n?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Cuentas conectadas</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Conecta tus redes para publicar clips desde el editor. Los tokens se guardan en el servidor y el navegador
          nunca los ve.
        </p>
      </div>
      <AccountsPanel connected={sp.connected} error={sp.error} count={sp.n ? Number(sp.n) : undefined} />
    </div>
  );
}
