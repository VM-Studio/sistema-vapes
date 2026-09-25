import { formatInTimeZone } from "date-fns-tz";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Lock,
  LockOpen,
  PackageX,
  Receipt,
  ShoppingCart,
  Truck,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Grafico } from "@/components/charts/grafico";
import { Kpi } from "@/components/reportes/kpi";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatearNumero, formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { limitesRango, type Rango } from "@/lib/zona-horaria";
import { estadoCajas } from "@/server/services/caja.service";
import { ETIQUETA_MEDIO_PAGO } from "@/server/services/comprobante.service";
import { recurrentesPendientes } from "@/server/services/gasto.service";
import {
  obtenerAlertasStock,
  obtenerResumenInventario,
} from "@/server/services/inventario.service";
import * as R from "@/server/services/reporte.service";
import { topVariantes } from "@/server/services/venta.service";

/**
 * Tarjetas del dashboard. Cada una es un Server Component asíncrono que se
 * envuelve en su propio <Suspense>: el HTML llega por streaming tarjeta por
 * tarjeta y ninguna espera a la consulta más lenta.
 */

export interface ContextoDashboard {
  rango: Rango;
  depositoId?: string;
  /** Empleado sin reportes: solo sus propias ventas. */
  usuarioId?: string;
  finanzas: boolean;
  tz: string;
}

const filtro = (c: ContextoDashboard): R.FiltroReporte => ({
  ...c.rango,
  depositoId: c.depositoId,
  usuarioId: c.usuarioId,
});

export function Tarjeta({
  titulo,
  accion,
  children,
  className,
}: {
  titulo: string;
  accion?: { href: string; label: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface flex min-w-0 flex-col gap-3 rounded-xl border p-4 md:p-5",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{titulo}</h2>
        {accion && (
          <Link
            href={accion.href}
            className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            {accion.label} <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

export function TarjetaCargando({
  titulo,
  alto = 180,
  className,
}: {
  titulo: string;
  alto?: number;
  className?: string;
}) {
  return (
    <Tarjeta titulo={titulo} className={className}>
      <Skeleton style={{ height: alto }} className="w-full" />
    </Tarjeta>
  );
}

export function KpisCargando({ n }: { n: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {Array.from({ length: n }, (_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-xl" />
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------

export async function KpisDashboard({ c, propio }: { c: ContextoDashboard; propio: boolean }) {
  const k = await R.kpis(filtro(c));
  const hint = `vs. ${k.periodoAnterior.desde.slice(8)}/${k.periodoAnterior.desde.slice(5, 7)}–${k.periodoAnterior.hasta.slice(8)}/${k.periodoAnterior.hasta.slice(5, 7)}`;
  return (
    <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <Kpi
        label={propio ? "Mis ventas" : "Ventas"}
        valor={formatearPesos(k.ventas.actual)}
        delta={k.ventas.delta}
        hint={hint}
      />
      <Kpi
        label="Cantidad de ventas"
        valor={formatearNumero(Number(k.cantidadVentas.actual))}
        delta={k.cantidadVentas.delta}
        hint={hint}
      />
      {c.finanzas && (
        <Kpi
          label="Ganancia bruta"
          valor={formatearPesos(k.gananciaBruta.actual)}
          delta={k.gananciaBruta.delta}
          hint={hint}
        />
      )}
      {c.finanzas && !propio && (
        <Kpi
          label="Ganancia neta"
          valor={formatearPesos(k.gananciaNeta.actual)}
          delta={k.gananciaNeta.delta}
          hint={hint}
        />
      )}
      <Kpi
        label="Unidades"
        valor={formatearNumero(Number(k.unidades.actual))}
        delta={k.unidades.delta}
        hint={hint}
      />
      <Kpi
        label="Ticket promedio"
        valor={formatearPesos(k.ticketPromedio.actual)}
        delta={k.ticketPromedio.delta}
        hint={hint}
      />
    </section>
  );
}

export async function GraficoVentas({ c }: { c: ContextoDashboard }) {
  const gran = R.granularidadPara(c.rango);
  const serie = await R.serieTemporal({ ...filtro(c), granularidad: gran });
  const etiqueta = (iso: string) =>
    gran === "mes" ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : `${iso.slice(8)}/${iso.slice(5, 7)}`;
  return (
    <Grafico
      alto={280}
      g={{
        id: "dash-serie",
        tipo: serie.length === 1 ? "barras" : "area",
        titulo: "Ventas",
        x: "periodo",
        formato: "moneda",
        series: [
          { clave: "ventas", nombre: "Ventas" },
          ...(c.finanzas ? [{ clave: "ganancia", nombre: "Ganancia bruta" }] : []),
        ],
        datos: serie.map((s) => ({
          periodo: etiqueta(s.periodo),
          ventas: Number(s.ventas),
          ...(c.finanzas ? { ganancia: Number(s.gananciaBruta) } : {}),
        })),
      }}
    />
  );
}

export async function StockPorGalpon({ c }: { c: ContextoDashboard }) {
  const [resumen, alertas, valor] = await Promise.all([
    obtenerResumenInventario({ incluirValorizacion: false }),
    obtenerAlertasStock(),
    c.finanzas ? R.valorizacionInventario() : Promise.resolve(null),
  ]);
  const sinStock = alertas.filter((a) => a.stockTotal <= 0).length;
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-2">
        {resumen.porDeposito.map((d) => {
          const v = valor?.porDeposito.find((x) => x.id === d.id);
          return (
            <li key={d.id}>
              <Link
                href={`/inventario?depositoId=${d.id}`}
                className="border-border hover:border-primary/40 block rounded-lg border p-3 transition-colors"
              >
                <p className="text-muted truncate text-xs font-medium uppercase">{d.nombre}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatearNumero(d.unidades)} u.
                </p>
                {v && (
                  <p className="text-muted text-xs tabular-nums">
                    {formatearPesos(v.valorCosto)} a costo
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {alertas.length > 0 ? (
        <Link
          href="/inventario?soloBajoMinimo=1"
          className="bg-warning-soft text-warning-soft-foreground flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {alertas.length} sabor{alertas.length === 1 ? "" : "es"} bajo el mínimo
            {sinStock > 0 && ` · ${sinStock} sin stock`}
          </span>
          <ArrowRight className="size-4 shrink-0" aria-hidden />
        </Link>
      ) : (
        <p className="text-muted text-sm">Todo por encima del mínimo.</p>
      )}
      {alertas.slice(0, 4).map((a) => (
        <p key={a.varianteId} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            {a.producto} — {a.variante}
          </span>
          <Badge variant={a.stockTotal <= 0 ? "danger" : "warning"}>
            {a.stockTotal} / mín. {a.stockMinimo}
          </Badge>
        </p>
      ))}
    </div>
  );
}

export async function TopSabores({ c }: { c: ContextoDashboard }) {
  const { inicio, fin } = limitesRango(c.rango.desde, c.rango.hasta, c.tz);
  const top = c.usuarioId
    ? (await R.rankingVariantes({ ...filtro(c), limit: 10 })).map((x) => ({
        nombre: x.nombre,
        unidades: x.unidades,
      }))
    : await topVariantes({
        desde: inicio,
        hasta: new Date(fin.getTime() - 1),
        depositoId: c.depositoId,
        limit: 10,
      });
  return (
    <Grafico
      alto={200}
      g={{
        id: "dash-top",
        tipo: "barrasH",
        titulo: "Top 10 sabores",
        x: "nombre",
        formato: "entero",
        series: [{ clave: "unidades", nombre: "Unidades" }],
        datos: top.map((t) => ({ nombre: t.nombre.replace(" — ", " · "), unidades: t.unidades })),
      }}
    />
  );
}

export async function SaboresLentos({ c }: { c: ContextoDashboard }) {
  const hasta = c.rango.hasta;
  const r = await R.rotacionInventario({
    desde: limitesDia30(hasta),
    hasta,
    depositoId: c.depositoId,
  });
  const muertos = r.filas
    .filter((x) => x.clase === "SIN_MOVIMIENTO")
    .sort((a, b) => b.stock - a.stock);
  if (muertos.length === 0)
    return (
      <p className="text-muted text-sm">
        Todo lo que tiene stock se vendió en los últimos 30 días.
      </p>
    );
  return (
    <ul className="divide-border flex flex-col divide-y text-sm">
      {muertos.slice(0, 8).map((m) => (
        <li key={m.varianteId} className="flex items-center justify-between gap-2 py-2">
          <Link
            href={`/productos/${m.productoId}`}
            className="flex min-w-0 items-center gap-2 hover:underline"
          >
            <PackageX className="text-muted size-4 shrink-0" aria-hidden />
            <span className="truncate">{m.nombre}</span>
          </Link>
          <span className="text-muted shrink-0 tabular-nums">
            {formatearNumero(m.stock)} u. sin vender
          </span>
        </li>
      ))}
    </ul>
  );
}

function limitesDia30(hasta: string): string {
  const d = new Date(`${hasta}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 29);
  return d.toISOString().slice(0, 10);
}

export async function MediosDePago({ c }: { c: ContextoDashboard }) {
  const m = await R.ventasPorMedioPago(filtro(c));
  return (
    <div className="flex flex-col gap-2">
      <Grafico
        alto={180}
        g={{
          id: "dash-medios",
          tipo: "donut",
          titulo: "Medios de pago",
          x: "medio",
          formato: "moneda",
          series: [{ clave: "total", nombre: "Cobrado" }],
          datos: m.medios.map((x) => ({
            medio: ETIQUETA_MEDIO_PAGO[x.medioPago],
            total: Number(x.total),
          })),
        }}
      />
      {Number(m.efectivoFueraDeCaja) > 0 && (
        <p className="bg-warning-soft text-warning-soft-foreground rounded-lg px-3 py-2 text-xs">
          {formatearPesos(m.efectivoFueraDeCaja)} en efectivo se cobraron sin caja abierta.
        </p>
      )}
    </div>
  );
}

export async function PorVendedor({ c }: { c: ContextoDashboard }) {
  const v = await R.ventasPorVendedor(filtro(c));
  if (v.length === 0) return <p className="text-muted text-sm">Sin ventas en el período.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-muted text-xs uppercase">
        <tr>
          <th className="py-1 text-left font-medium">Vendedor</th>
          <th className="py-1 text-right font-medium">Ventas</th>
          <th className="py-1 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {v.map((x) => (
          <tr key={x.usuarioId}>
            <td className="py-2">{x.nombre}</td>
            <td className="py-2 text-right tabular-nums">{x.cantidad}</td>
            <td className="py-2 text-right font-medium tabular-nums">{formatearPesos(x.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export async function EstadoCaja({
  c,
  puedeOperar,
}: {
  c: ContextoDashboard;
  puedeOperar: boolean;
}) {
  const cajas = await estadoCajas();
  return (
    <ul className="flex flex-col gap-2">
      {cajas
        .filter((x) => !c.depositoId || x.depositoId === c.depositoId)
        .map((x) => (
          <li
            key={x.depositoId}
            className="border-border flex flex-wrap items-center gap-3 rounded-lg border p-3"
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full",
                x.caja ? "bg-success-soft text-success-soft-foreground" : "bg-surface-2 text-muted",
              )}
            >
              {x.caja ? (
                <LockOpen className="size-4" aria-hidden />
              ) : (
                <Lock className="size-4" aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{x.deposito}</p>
              <p className="text-muted text-xs">
                {x.caja
                  ? `Abierta desde las ${formatInTimeZone(x.caja.abiertaAt, c.tz, "HH:mm")} por ${x.caja.abiertaPor}`
                  : "Cerrada"}
              </p>
            </div>
            {x.caja && (
              <div className="text-right">
                <p className="text-muted text-xs">Efectivo esperado</p>
                <p className="font-semibold tabular-nums">
                  {formatearPesos(x.caja.totales.esperado)}
                </p>
              </div>
            )}
            {puedeOperar && (
              <Link
                href={`/caja?deposito=${x.depositoId}${x.caja ? "&accion=cerrar" : "&accion=abrir"}`}
                className={buttonVariants({
                  variant: x.caja ? "secondary" : "primary",
                  size: "sm",
                  className: "w-full sm:w-auto",
                })}
              >
                {x.caja ? "Cerrar caja" : "Abrir caja"}
              </Link>
            )}
          </li>
        ))}
    </ul>
  );
}

export async function CuentasPorCobrar() {
  const c = await R.cuentasPorCobrar();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xl font-semibold tabular-nums">{formatearPesos(c.total.saldo)}</p>
      {Number(c.total.d60) > 0 && (
        <p className="text-danger text-xs">{formatearPesos(c.total.d60)} con más de 60 días</p>
      )}
      <ul className="divide-border flex flex-col divide-y text-sm">
        {c.clientes.slice(0, 5).map((x) => (
          <li key={x.clienteId} className="flex items-center justify-between gap-2 py-2">
            <Link href={`/clientes/${x.clienteId}`} className="min-w-0 truncate hover:underline">
              {x.nombre}
            </Link>
            <span className="shrink-0 font-medium tabular-nums">{formatearPesos(x.saldo)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function Pendientes({
  ver,
}: {
  ver: { transferencias: boolean; compras: boolean; ventas: boolean; gastos: boolean };
}) {
  const [p, recurrentes] = await Promise.all([
    R.pendientes(),
    ver.gastos ? recurrentesPendientes() : Promise.resolve([]),
  ]);
  const items = [
    ver.transferencias && {
      href: "/movimientos/transferencias?estado=PENDIENTE",
      icono: Truck,
      n: p.transferencias,
      texto: ["transferencia pendiente", "transferencias pendientes"],
    },
    ver.compras && {
      href: "/compras?estado=BORRADOR",
      icono: ClipboardList,
      n: p.compras,
      texto: ["compra en borrador", "compras en borrador"],
    },
    ver.ventas && {
      href: "/ventas?estado=BORRADOR",
      icono: ShoppingCart,
      n: p.ventas,
      texto: ["venta en borrador", "ventas en borrador"],
    },
    ver.gastos && {
      href: "/gastos",
      icono: Receipt,
      n: recurrentes.length,
      texto: ["gasto recurrente sin cargar", "gastos recurrentes sin cargar"],
    },
  ].filter(Boolean) as { href: string; icono: typeof Truck; n: number; texto: [string, string] }[];
  const hay = items.filter((i) => i.n > 0);
  if (hay.length === 0) return <p className="text-muted text-sm">Nada pendiente. 👌</p>;
  return (
    <ul className="flex flex-col gap-1">
      {hay.map((i) => (
        <li key={i.href}>
          <Link
            href={i.href}
            className="hover:bg-surface-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm"
          >
            <i.icono className="text-muted size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold tabular-nums">{i.n}</span> {i.texto[i.n === 1 ? 0 : 1]}
            </span>
            <ArrowRight className="text-muted size-4" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
