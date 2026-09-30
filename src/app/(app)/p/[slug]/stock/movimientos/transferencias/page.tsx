import { redirect } from "next/navigation";

type SP = Record<string, string | string[] | undefined>;

/** Ruta vieja: las transferencias viven en /stock/transferencias (conserva los filtros). */
export default async function TransferenciasViejaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SP>;
}) {
  const { slug } = await params;
  const sp = new URLSearchParams(
    Object.entries(await searchParams).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  ).toString();
  redirect(`/p/${slug}/stock/transferencias${sp ? `?${sp}` : ""}`);
}
