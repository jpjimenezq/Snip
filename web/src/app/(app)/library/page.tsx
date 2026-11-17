import { Library } from "@/components/Library";

export const metadata = { title: "Biblioteca · Snip" };

export default function LibraryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Biblioteca</h1>
      <Library />
    </div>
  );
}
