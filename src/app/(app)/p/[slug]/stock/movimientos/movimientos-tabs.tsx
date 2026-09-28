import { Warehouse } from "lucide-react";

import { ChipLink, ChipRow } from "@/components/ui/chip";
import { hrefCon, type ParamsUrl } from "@/components/ui/pagination";
import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel, type PanelBasico } from "@/lib/paneles";

export type SeccionStock = "stock" | "ledger" | "transferencias";

/**
 * Sub-navegación de las pantallas secundarias de Stock (movimientos y
 * transferencias): vuelve al stock por galpón y conserva el depósito elegido.
 */
export function StockTabs({
  panel,
  actual,
  depositoId,
}: {
  panel: PanelBasico;
  actual: SeccionStock;
  depositoId?: string;
}) {
  const con = (ruta: string, param: string) =>
    rutaPanel(panel.slug, depositoId ? `${ruta}?${param}=${depositoId}` : ruta);
  const items = [
    { id: "stock", href: con("/stock", "tab"), label: "Stock por galpón" },
    { id: "ledger", href: con("/stock/movimientos", "depositoId"), label: "Movimientos" },
    {
      id: "transferencias",
      href: con("/stock/movimientos/transferencias", "depositoId"),
      label: "Transferencias",
    },
  ] as const;
  return (
    <TabsNav
      className="mb-4"
      ariaLabel="Stock"
      items={items.map((i) => ({ href: i.href, label: i.label, activo: i.id === actual }))}
    />
  );
}

/** Selector de depósito: "Global" (todos los depósitos del panel) o uno en particular. */
export function SelectorDeposito({
  depositos,
  actual,
  pathname,
  params,
  className,
}: {
  depositos: { id: string; nombre: string }[];
  actual: string | undefined;
  pathname: string;
  params: ParamsUrl;
  className?: string;
}) {
  const link = (depositoId: string | null) => hrefCon(pathname, params, { depositoId, page: null });
  return (
    <ChipRow ariaLabel="Depósito" className={className}>
      <ChipLink href={link(null)} activo={!actual}>
        <Warehouse strokeWidth={1.75} /> Todos los galpones
      </ChipLink>
      {depositos.map((d) => (
        <ChipLink key={d.id} href={link(d.id)} activo={actual === d.id}>
          {d.nombre}
        </ChipLink>
      ))}
    </ChipRow>
  );
}
