import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { TabsNav } from "@/components/ui/tabs-nav";
import { MONEDA_CAMBIO_LABEL } from "@/lib/cambio";
import { formatearPesos } from "@/lib/format";
import { formatearFechaHora } from "@/lib/utils";
import { requirePaginaOwner } from "@/server/auth/permissions";
import { detalleCotizaciones, type DetalleMoneda } from "@/server/services/cambio.service";

import { tabsConfiguracion } from "../secciones";
import { BotonActualizar, FrecuenciaForm, OverrideForm } from "./formularios";

export const metadata: Metadata = { title: "Cotizaciones" };
export const dynamic = "force-dynamic";

const USO: Record<DetalleMoneda["moneda"], string> = {
  USD_BLUE: "Precios mayoristas en dólares (venta).",
  USDT: "Precios de proveedores en USDT.",
};

function TarjetaMoneda({ d }: { d: DetalleMoneda }) {
  const v = d.venta;
  return (
    <SectionCard
      title={MONEDA_CAMBIO_LABEL[d.moneda]}
      description={USO[d.moneda]}
      action={
        v?.esManual ? (
          <Badge variant="warning">Manual</Badge>
        ) : v?.desactualizada ? (
          <Badge variant="danger">
            <AlertTriangle strokeWidth={1.75} aria-hidden /> Desactualizada
          </Badge>
        ) : v ? (
          <Badge variant="success">Automática</Badge>
        ) : null
      }
      contentClassName="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-1" data-testid={`cotizacion-${d.moneda}`}>
        <span className="text-muted text-small">Venta</span>
        <span className="text-h1 font-semibold tabular-nums">
          {v ? formatearPesos(v.valor) : "Sin cotización"}
        </span>
        {v ? (
          <span className="text-muted text-small">
            {v.esManual
              ? `Cargada a mano${v.cargadaPor ? ` por ${v.cargadaPor}` : ""} el ${formatearFechaHora(v.obtenidoAt)}`
              : `${v.fuente} · ${formatearFechaHora(v.obtenidoAt)}`}
            {d.compra && !d.compra.esManual && ` · Compra ${formatearPesos(d.compra.valor)}`}
          </span>
        ) : (
          <span className="text-muted text-small">
            Todavía no se pudo obtener. Tocá «Actualizar ahora» o cargala a mano.
          </span>
        )}
        {v?.esManual && d.automatica && (
          <span className="text-subtle text-small">
            Automática: {formatearPesos(d.automatica.valor)} ({d.automatica.fuente},{" "}
            {formatearFechaHora(d.automatica.obtenidoAt)})
          </span>
        )}
      </div>

      <OverrideForm moneda={d.moneda} override={d.override?.valor ?? null} />

      {d.historial.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-small font-semibold">Últimas actualizaciones</h3>
          <ul className="divide-border border-border rounded-control divide-y border">
            {d.historial.map((h) => (
              <li
                key={h.obtenidoAt + h.fuente}
                className="text-small flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="text-muted">{formatearFechaHora(h.obtenidoAt)}</span>
                <span className="text-subtle hidden truncate sm:inline">{h.fuente}</span>
                <span className="font-medium tabular-nums">{formatearPesos(h.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

export default async function CambioPage() {
  await requirePaginaOwner();
  const detalle = await detalleCotizaciones();
  return (
    <>
      <TabsNav
        items={tabsConfiguracion("/configuracion/cambio")}
        className="mb-6"
        ariaLabel="Configuración"
      />
      <PageHeader
        title="Cotizaciones"
        subtitle="Dólar blue y USDT en pesos, para todos los sistemas. Se actualizan solas; un valor cargado a mano manda hasta que lo quites."
        actions={<BotonActualizar />}
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {detalle.monedas.map((d) => (
          <TarjetaMoneda key={d.moneda} d={d} />
        ))}
        <FrecuenciaForm minutos={detalle.frecuenciaMinutos} />
      </div>
    </>
  );
}
