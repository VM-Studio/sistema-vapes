import { Modulo } from "@prisma/client";
import { Warehouse } from "lucide-react";

import { ChipLink, ChipRow } from "@/components/ui/chip";
import { hrefCon, type ParamsUrl } from "@/components/ui/pagination";
import { TabsNav } from "@/components/ui/tabs-nav";
import { rutaPanel, type PanelBasico } from "@/lib/paneles";
import { puede, type SujetoPermisos } from "@/lib/permisos";

export type SeccionStock = "stock" | "ledger" | "ingreso" | "ajuste" | "transferencias";

/**
 * Sub-navegación del módulo Stock: solo muestra lo que el usuario puede hacer
 * en este panel. Las vistas de consulta conservan el depósito elegido.
 */
export function StockTabs({
  panel,
  usuario,
  actual,
  depositoId,
}: {
  panel: PanelBasico;
  usuario: SujetoPermisos;
  actual: SeccionStock;
  depositoId?: string;
}) {
  const conDeposito = (ruta: string) =>
    rutaPanel(panel.slug, depositoId ? `${ruta}?depositoId=${depositoId}` : ruta);
  const items = [
    { id: "stock", href: conDeposito("/stock"), label: "Stock", accion: "ver" },
    { id: "ledger", href: conDeposito("/stock/movimientos"), label: "Movimientos", accion: "ver" },
    {
      id: "ingreso",
      href: rutaPanel(panel.slug, "/stock/movimientos/ingreso"),
      label: "Ingreso",
      accion: "crear",
    },
    {
      id: "ajuste",
      href: rutaPanel(panel.slug, "/stock/movimientos/ajuste"),
      label: "Ajuste / recuento",
      accion: "editar",
    },
    {
      id: "transferencias",
      href: conDeposito("/stock/movimientos/transferencias"),
      label: "Transferencias",
      accion: "ver",
    },
  ] as const;
  return (
    <TabsNav
      className="mb-4"
      ariaLabel="Stock"
      items={items
        .filter((i) => puede(usuario, panel.id, Modulo.STOCK, i.accion))
        .map((i) => ({ href: i.href, label: i.label, activo: i.id === actual }))}
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
        <Warehouse strokeWidth={1.75} /> Global
      </ChipLink>
      {depositos.map((d) => (
        <ChipLink key={d.id} href={link(d.id)} activo={actual === d.id}>
          {d.nombre}
        </ChipLink>
      ))}
    </ChipRow>
  );
}
