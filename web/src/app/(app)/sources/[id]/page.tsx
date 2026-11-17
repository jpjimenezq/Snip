import { SourceView } from "@/components/SourceView";

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SourceView id={id} />;
}
