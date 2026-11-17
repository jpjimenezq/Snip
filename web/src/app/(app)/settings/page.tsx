import { AccountsPanel } from "@/components/AccountsPanel";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Ajustes · Snip" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; n?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div>
      <PageTitle title="Cuentas conectadas">
        Conecta tus redes para publicar clips desde el editor. Los tokens se guardan en el servidor y el navegador
        nunca los ve.
      </PageTitle>
      <AccountsPanel connected={sp.connected} error={sp.error} count={sp.n ? Number(sp.n) : undefined} />
    </div>
  );
}
