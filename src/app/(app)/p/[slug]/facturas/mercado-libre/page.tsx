import { redirect } from "next/navigation";

import { rutaPanel } from "@/lib/paneles";

type SP = Record<string, string | string[] | undefined>;

/** Ruta vieja (A3): las ventas Mercado Libre ahora son la página principal de Facturas. */
export default async function VentasMLViejaPage({
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
  );
  redirect(rutaPanel(slug, sp.size ? `/facturas?${sp}` : "/facturas"));
}
