import { redirect } from "next/navigation";

/** Ruta vieja del detalle: redirige a /stock/transferencias/[id]. */
export default async function TransferenciaViejaPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  redirect(`/p/${slug}/stock/transferencias/${encodeURIComponent(id)}`);
}
