import { Library } from "@/components/Library";
import { PageTitle } from "@/components/ui";

export const metadata = { title: "Biblioteca · Snip" };

export default function LibraryPage() {
  return (
    <div>
      <PageTitle title="Biblioteca">Todos tus clips: busca, filtra por estado u origen y ordena por puntaje viral.</PageTitle>
      <Library />
    </div>
  );
}
