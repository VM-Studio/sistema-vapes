import {
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileSpreadsheet,
  HandCoins,
  PenLine,
  Receipt,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { formatearNumero, formatearPesos } from "@/lib/format";
import {
  ETIQUETA_CATEGORIA,
  nombreMes,
  nombreMesTitulo,
  sumarMeses,
  type CategoriaGanancia,
  type FilaGanancia,
  type ResumenCategoria,
  type Tarifas,
} from "@/lib/ganancia-vendedor";
import { cn, formatearFecha, formatearFechaHora } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";
import type { GananciaMes, Liquidacion } from "@/server/services/ganancia-vendedor.service";
import type { FirmaVista, Remito } from "@/server/services/remito-liquidacion.service";

import {
  GenerarLiquidacion,
  ReenviarRemito,
  RegistrarPago,
  TarifasDialog,
} from "./acciones-ganancia";
import { FirmarRemito } from "./firmar-remito";

const VARIANTE_CATEGORIA: Record<CategoriaGanancia, "neutral" | "primary" | "success"> = {
  MINORISTA: "neutral",
  MAYORISTA: "primary",
  MINORISTA_NUEVO: "success",
  MAYORISTA_NUEVO: "success",
};

export function BadgeCategoria({ categoria }: { categoria: CategoriaGanancia }) {
  return <Badge variant={VARIANTE_CATEGORIA[categoria]}>{ETIQUETA_CATEGORIA[categoria]}</Badge>;
}

export function EstadoLiquidacionBadge({
  l,
  vendedor,
}: {
  l: Pick<Liquidacion, "estado"> | null;
  /** "Pagada · esperando firma de {vendedor}". */
  vendedor?: string;
}) {
  if (!l) return <Badge variant="neutral">Sin liquidar</Badge>;
  if (l.estado === "PENDIENTE") return <Badge variant="warning">Pendiente de pago</Badge>;
  if (l.estado === "PAGADA")
    return (
      <Badge variant="warning">
        {vendedor ? `Pagada · esperando firma de ${vendedor}` : "Pagada · falta firma"}
      </Badge>
    );
  return (
    <Badge variant="success">
      <PenLine aria-hidden /> Firmada
    </Badge>
  );
}

/**
 * "Ganancia de {vendedor}" del mes elegido: total ganado (a hoy si es el mes
 * en curso), desglose por las 4 categorías, ventas y devoluciones con su
 * ganancia (cada una abre la venta), estado de la liquidación e historial.
 * La usan "Ventas de {vendedor}" (dueños, con las acciones) y "Mi ganancia"
 * (el vendedor, sin acciones). Sin datos de ganancia del negocio.
 */
export function SeccionGanancia({
  g,
  historial,
  slug,
  dueno,
  tarifasVigentes,
  hrefMes,
  rutaVenta,
  titulo,
  remito,
  usuarioActual,
}: {
  g: GananciaMes;
  /** Remito del pago del mes (con firmas y envíos), si ya se pagó. */
  remito: Remito | null;
  /** Quien mira (el dueño firma con su nombre; el vendedor firma lo suyo). */
  usuarioActual: { id: string; nombre: string };
  historial: Liquidacion[];
  slug: string;
  /** Vista de dueño: tarifas, generar liquidación y registrar pago. */
  dueno: boolean;
  tarifasVigentes: Tarifas | null;
  hrefMes: (mes: string) => string;
  /** Link al detalle de una venta (null = sin link). */
  rutaVenta: ((ventaId: string) => string) | null;
  titulo?: string;
}) {
  const { calculo, liquidacion: l } = g;
  const nombre = g.usuario.nombre;
  const mesLabel = nombreMes(g.mes);
  const anterior = sumarMeses(g.mes, -1);
  const siguiente = sumarMeses(g.mes, 1);
  const etiquetaTotal = g.enCurso
    ? "Ganado a hoy"
    : l
      ? l.estado === "PENDIENTE"
        ? "Le corresponde"
        : "Liquidado"
      : "Ganado en el mes";

  return (
    <section
      id="ganancia"
      aria-labelledby="titulo-ganancia"
      className="flex scroll-mt-20 flex-col gap-4"
      data-testid="seccion-ganancia"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="titulo-ganancia" className="text-h2 font-semibold">
            {titulo ?? `Ganancia de ${nombre}`}
          </h2>
          <p className="text-muted text-small">
            Por vape vendido, según el tipo de venta y si el cliente es nuevo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dueno && (
            <TarifasDialog usuarioId={g.usuario.id} nombre={nombre} tarifas={tarifasVigentes} />
          )}
          <a
            href={`/api/p/${slug}/equipo/${g.usuario.id}/ganancia?mes=${g.mes}`}
            className={buttonVariants({ variant: "secondary" })}
            download
          >
            <FileSpreadsheet strokeWidth={1.75} aria-hidden /> Exportar Excel
          </a>
        </div>
      </div>

      {/* Mes */}
      <nav
        aria-label="Mes de la ganancia"
        className="bg-card rounded-card flex items-center justify-between gap-2 p-2"
      >
        <Link
          href={hrefMes(anterior)}
          scroll={false}
          className={buttonVariants({ variant: "ghost", size: "icon" })}
          aria-label={`Mes anterior (${nombreMes(anterior)})`}
        >
          <ChevronLeft strokeWidth={1.75} aria-hidden />
        </Link>
        <div className="flex min-w-0 flex-col items-center text-center">
          <p className="truncate font-semibold" data-testid="mes-ganancia">
            {nombreMesTitulo(g.mes)}
          </p>
          <p className="text-subtle text-small">
            {g.enCurso
              ? `En curso · actualizado ${formatearFechaHora(g.calculadoAt)}`
              : l
                ? `Mes cerrado · liquidación del ${formatearFecha(l.generadaAt)}`
                : g.terminado
                  ? "Mes cerrado · sin liquidar"
                  : "Mes futuro"}
          </p>
        </div>
        {g.enCurso ? (
          <span className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "opacity-30")}>
            <ChevronRight strokeWidth={1.75} aria-hidden />
          </span>
        ) : (
          <Link
            href={hrefMes(siguiente)}
            scroll={false}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
            aria-label={`Mes siguiente (${nombreMes(siguiente)})`}
          >
            <ChevronRight strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </nav>

      <EstadoLiquidacion
        g={g}
        dueno={dueno}
        mesLabel={mesLabel}
        remito={remito}
        usuarioActual={usuarioActual}
        slug={slug}
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard
          label={etiquetaTotal}
          value={<span data-testid="total-ganancia">{formatearPesos(calculo.total)}</span>}
          icono={HandCoins}
          acento="oliva"
          className="col-span-2 lg:col-span-1"
        />
        <StatCard label="Ventas" value={formatearNumero(calculo.cantidadVentas)} />
        <StatCard label="Vapes" value={formatearNumero(calculo.unidades)} />
        <StatCard
          label="Total vendido"
          value={formatearPesos(calculo.totalVendido)}
          className="col-span-2 lg:col-span-1"
        />
      </div>

      <TablaCategorias categorias={calculo.categorias} total={calculo.total} />

      <TablaVentas
        filas={calculo.filas}
        nombre={nombre}
        mesLabel={mesLabel}
        rutaVenta={rutaVenta}
      />

      {historial.length > 0 && (
        <Historial historial={historial} hrefMes={hrefMes} mesActual={g.mes} />
      )}
    </section>
  );
}

function EstadoLiquidacion({
  g,
  dueno,
  mesLabel,
  remito,
  usuarioActual,
  slug,
}: {
  g: GananciaMes;
  dueno: boolean;
  mesLabel: string;
  remito: Remito | null;
  usuarioActual: { id: string; nombre: string };
  slug: string;
}) {
  const l = g.liquidacion;
  if (g.enCurso) return null;
  if (!l) {
    if (!g.terminado) return null;
    return (
      <div className="bg-card rounded-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <p className="text-sm">
          {mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1)} terminó y no tiene liquidación (es
          anterior a la ganancia por vape).
        </p>
        {dueno && <GenerarLiquidacion usuarioId={g.usuario.id} mes={g.mes} />}
      </div>
    );
  }
  if (l.estado !== "PENDIENTE" && remito)
    return (
      <PanelRemito
        r={remito}
        l={l}
        dueno={dueno}
        slug={slug}
        esVendedor={usuarioActual.id === g.usuario.id}
      />
    );
  return (
    <div
      className="bg-card rounded-card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between md:p-5"
      data-testid="estado-liquidacion"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <EstadoLiquidacionBadge l={l} vendedor={g.usuario.nombre} />
          <span className="text-sm font-semibold">
            {l.estado === "PENDIENTE"
              ? `Le corresponden ${formatearPesos(l.total)}`
              : `Se le pagaron ${formatearPesos(l.pago!.monto)}`}
          </span>
        </div>
        <p className="text-muted text-small">
          {l.estado === "PENDIENTE"
            ? `Liquidación ${l.generadaPor ? `generada por ${l.generadaPor}` : "generada automáticamente"} el ${formatearFechaHora(l.generadaAt)} con las tarifas de ese momento.`
            : `${ETIQUETA_MEDIO_PAGO[l.pago!.medioPago]} · ${formatearFecha(l.pago!.fecha)} · registró ${l.pago!.registradoPor.nombre}${l.pago!.referencia ? ` · ${l.pago!.referencia}` : ""}`}
        </p>
      </div>
      {dueno && l.estado === "PENDIENTE" && (
        <div className="flex flex-col-reverse gap-2 md:flex-row">
          <GenerarLiquidacion usuarioId={g.usuario.id} mes={g.mes} recalcular />
          <RegistrarPago
            liquidacionId={l.id}
            nombre={g.usuario.nombre}
            mesLabel={mesLabel}
            total={l.total}
            dueno={usuarioActual.nombre}
          />
        </div>
      )}
    </div>
  );
}

const ETIQUETA_RESULTADO = {
  ENVIADO: "Enviado",
  SIN_CONFIGURAR: "No enviado (mail sin configurar)",
  ERROR: "Error al enviar",
} as const;

/**
 * Liquidación pagada: estado de las firmas, las dos firmas (quién y cuándo),
 * el PDF del remito, reenviar (dueños) y los envíos por mail. El vendedor
 * firma acá si todavía no lo hizo.
 */
function PanelRemito({
  r,
  l,
  dueno,
  slug,
  esVendedor,
}: {
  r: Remito;
  l: Liquidacion;
  dueno: boolean;
  slug: string;
  esVendedor: boolean;
}) {
  const pago = l.pago!;
  const firmada = r.estado === "FIRMADA";
  return (
    <div
      className="bg-card rounded-card flex flex-col gap-5 p-4 md:p-5"
      data-testid="estado-liquidacion"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <EstadoLiquidacionBadge l={l} vendedor={r.vendedor.nombre} />
            <span className="text-sm font-semibold">
              Se le pagaron {formatearPesos(pago.monto)}
            </span>
          </div>
          <p className="text-muted text-small">
            {ETIQUETA_MEDIO_PAGO[pago.medioPago]} · {formatearFecha(pago.fecha)} · registró{" "}
            {pago.registradoPor.nombre}
            {pago.referencia ? ` · ${pago.referencia}` : ""} · remito {r.numero}
          </p>
        </div>
        <div className="flex flex-col gap-2 md:flex-row">
          <a
            href={`/api/p/${slug}/liquidaciones/${r.id}/remito`}
            target="_blank"
            rel="noopener"
            className={buttonVariants({ variant: "secondary" })}
            data-testid="pdf-remito"
          >
            <FileDown strokeWidth={1.75} aria-hidden />
            {firmada ? "Remito firmado (PDF)" : "Remito (PDF)"}
          </a>
          {dueno && (
            <ReenviarRemito liquidacionId={r.id} nombre={r.vendedor.nombre} firmado={firmada} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="firmas-remito">
        <TarjetaFirma titulo="Firma del dueño" f={r.firmaDueno} pendiente="Sin firma" />
        <TarjetaFirma
          titulo={`Firma de ${r.vendedor.nombre}`}
          f={r.firmaVendedor}
          pendiente={
            r.link?.vencido
              ? "El link venció: reenviale el remito"
              : `Esperando la firma${r.link?.venceAt ? ` (el link vence el ${formatearFecha(r.link.venceAt)})` : ""}`
          }
        />
      </div>

      {esVendedor && !firmada && (
        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <p className="text-sm">
            Revisá el remito y firmalo. Lo firmó{" "}
            <span className="font-semibold">
              {r.firmaDueno?.nombre ?? pago.registradoPor.nombre}
            </span>{" "}
            como dueño.
          </p>
          <FirmarRemito nombre={r.vendedor.nombre} modo={{ liquidacionId: r.id }} />
        </div>
      )}

      {dueno && r.envios.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">Envíos por mail</h4>
          <ul className="divide-border text-small divide-y" data-testid="envios-remito">
            {r.envios.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-muted tabular-nums">{formatearFechaHora(e.createdAt)}</span>
                <span>
                  {e.tipo === "PARA_FIRMAR" ? "Para firmar" : "Firmado"} →{" "}
                  {e.destinatarios.join(", ") || "sin destinatarios"}
                </span>
                <Badge
                  variant={
                    e.resultado === "ENVIADO"
                      ? "success"
                      : e.resultado === "ERROR"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {ETIQUETA_RESULTADO[e.resultado]}
                </Badge>
                {e.enviadoPor && <span className="text-subtle">por {e.enviadoPor}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TarjetaFirma({
  titulo,
  f,
  pendiente,
}: {
  titulo: string;
  f: FirmaVista | null;
  pendiente: string;
}) {
  return (
    <figure className="bg-surface rounded-inner flex flex-col gap-2 p-3">
      <figcaption className="text-muted text-small font-medium">{titulo}</figcaption>
      <div className="bg-card rounded-inner flex h-28 items-center justify-center overflow-hidden">
        {f ? (
          // Data URL de la firma guardada en la DB: next/image no aporta nada acá.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={f.imagen}
            alt={`${titulo}: ${f.nombre}`}
            className="max-h-24 max-w-full object-contain"
          />
        ) : (
          <span className="text-subtle text-small px-3 text-center">{pendiente}</span>
        )}
      </div>
      {f && (
        <p className="text-small">
          <span className="font-semibold">{f.nombre}</span>{" "}
          <span className="text-muted">
            · {formatearFechaHora(f.firmadaAt)}
            {f.rol === "VENDEDOR" && f.medio
              ? ` · ${f.medio === "link" ? "por el link" : "desde su usuario"}`
              : ""}
            {f.rol === "VENDEDOR" && f.ip ? ` · IP ${f.ip}` : ""}
          </span>
        </p>
      )}
    </figure>
  );
}

function TablaCategorias({ categorias, total }: { categorias: ResumenCategoria[]; total: string }) {
  const columnas = [
    {
      key: "categoria",
      header: "Categoría",
      cell: (c: ResumenCategoria) => <BadgeCategoria categoria={c.categoria} />,
    },
    {
      key: "ventas",
      header: "Ventas",
      className: "text-right",
      cell: (c: ResumenCategoria) => formatearNumero(c.ventas),
    },
    {
      key: "vapes",
      header: "Vapes",
      className: "text-right",
      cell: (c: ResumenCategoria) => <VapesCategoria c={c} />,
    },
    {
      key: "tarifa",
      header: "Por vape",
      className: "text-right",
      cell: (c: ResumenCategoria) => formatearPesos(c.tarifa),
    },
    {
      key: "monto",
      header: "Ganancia",
      className: "text-right font-semibold",
      cell: (c: ResumenCategoria) => formatearPesos(c.monto),
    },
    {
      key: "vendido",
      header: "Total vendido",
      className: "text-right",
      cell: (c: ResumenCategoria) => formatearPesos(c.totalVendido),
    },
  ];
  return (
    <div className="flex flex-col gap-2" data-testid="categorias-ganancia">
      <DataTable
        columns={columnas}
        rows={categorias}
        getRowKey={(c) => c.categoria}
        caption="Ganancia por categoría"
        renderMobile={(c) => (
          <div className="bg-card rounded-card flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <BadgeCategoria categoria={c.categoria} />
              <span className="font-semibold tabular-nums">{formatearPesos(c.monto)}</span>
            </div>
            <p className="text-muted text-small tabular-nums">
              {formatearNumero(c.ventas)} {c.ventas === 1 ? "venta" : "ventas"} ·{" "}
              <VapesCategoria c={c} /> × {formatearPesos(c.tarifa)} · vendido{" "}
              {formatearPesos(c.totalVendido)}
            </p>
          </div>
        )}
      />
      <p className="text-small flex justify-end gap-2 px-1 font-semibold tabular-nums">
        <span className="text-muted font-medium">Total</span> {formatearPesos(total)}
      </p>
    </div>
  );
}

function VapesCategoria({ c }: { c: ResumenCategoria }) {
  return (
    <span>
      {formatearNumero(c.unidades - c.unidadesDevueltas)}
      {c.unidadesDevueltas > 0 && (
        <span className="text-subtle"> ({formatearNumero(c.unidadesDevueltas)} devueltos)</span>
      )}
    </span>
  );
}

function TablaVentas({
  filas,
  nombre,
  mesLabel,
  rutaVenta,
}: {
  filas: FilaGanancia[];
  nombre: string;
  mesLabel: string;
  rutaVenta: ((ventaId: string) => string) | null;
}) {
  const codigo = (f: FilaGanancia) => {
    const texto =
      f.tipo === "VENTA" ? (
        f.codigo
      ) : (
        <>
          {f.codigo} <span className="text-subtle font-normal">de {f.ventaCodigo}</span>
        </>
      );
    return rutaVenta ? (
      <Link
        href={rutaVenta(f.ventaId)}
        className="text-foreground font-mono font-semibold hover:underline"
      >
        {texto}
      </Link>
    ) : (
      <span className="font-mono font-semibold">{texto}</span>
    );
  };
  const columnas = [
    { key: "fecha", header: "Fecha", cell: (f: FilaGanancia) => formatearFechaHora(f.fecha) },
    { key: "codigo", header: "Venta", cell: codigo },
    {
      key: "cliente",
      header: "Cliente",
      cell: (f: FilaGanancia) => <span className="block max-w-56 truncate">{f.cliente}</span>,
    },
    {
      key: "categoria",
      header: "Categoría",
      cell: (f: FilaGanancia) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <BadgeCategoria categoria={f.categoria} />
          {f.tipo === "DEVOLUCION" && <Badge variant="warning">Devolución</Badge>}
        </span>
      ),
    },
    {
      key: "vapes",
      header: "Vapes",
      className: "text-right",
      cell: (f: FilaGanancia) => formatearNumero(f.unidades),
    },
    {
      key: "ganancia",
      header: "Ganancia",
      className: "text-right font-semibold",
      cell: (f: FilaGanancia) => formatearPesos(f.ganancia),
    },
    {
      key: "total",
      header: "Total venta",
      className: "text-right",
      cell: (f: FilaGanancia) => (f.tipo === "VENTA" ? formatearPesos(f.totalVenta) : "—"),
    },
  ];
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-h3 font-semibold">Ventas de {mesLabel}</h3>
      <DataTable
        columns={columnas}
        rows={filas}
        getRowKey={(f) => `${f.tipo}-${f.id}`}
        caption={`Ganancia de ${nombre} por venta`}
        renderMobile={(f) => {
          const contenido = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-sm font-semibold">
                  {f.codigo}
                  {f.tipo === "DEVOLUCION" && (
                    <span className="text-subtle font-normal"> de {f.ventaCodigo}</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">{formatearPesos(f.ganancia)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm">{f.cliente}</span>
                <BadgeCategoria categoria={f.categoria} />
              </div>
              <p className="text-subtle text-small tabular-nums">
                {formatearFechaHora(f.fecha)} · {formatearNumero(f.unidades)}{" "}
                {Math.abs(f.unidades) === 1 ? "vape" : "vapes"} × {formatearPesos(f.tarifa)}
                {f.tipo === "VENTA" ? ` · venta ${formatearPesos(f.totalVenta)}` : " · devolución"}
              </p>
            </>
          );
          return rutaVenta ? (
            <Link
              href={rutaVenta(f.ventaId)}
              className={cn(cardVariants({ variant: "clickable" }), "flex flex-col gap-2 p-4")}
            >
              {contenido}
            </Link>
          ) : (
            <div className="bg-card rounded-card flex flex-col gap-2 p-4">{contenido}</div>
          );
        }}
        empty={<EmptyState icon={Receipt} title={`Todavía no hay ventas en ${mesLabel}`} />}
      />
    </div>
  );
}

function Historial({
  historial,
  hrefMes,
  mesActual,
}: {
  historial: Liquidacion[];
  hrefMes: (mes: string) => string;
  mesActual: string;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="historial-liquidaciones">
      <h3 className="text-h3 font-semibold">Liquidaciones</h3>
      <ul className="bg-card rounded-card divide-border divide-y">
        {historial.map((l) => (
          <li key={l.id}>
            <Link
              href={hrefMes(l.mes)}
              scroll={false}
              aria-current={l.mes === mesActual ? "true" : undefined}
              className="hover:bg-surface-2/60 aria-[current]:bg-azul-velo-1 flex min-h-14 items-center gap-3 px-4 py-3 transition-colors md:px-5"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{nombreMesTitulo(l.mes)}</span>
                <span className="text-subtle text-small tabular-nums">
                  {formatearNumero(l.cantidadVentas)} {l.cantidadVentas === 1 ? "venta" : "ventas"}{" "}
                  · {formatearNumero(l.unidades)} vapes
                </span>
              </div>
              <EstadoLiquidacionBadge l={l} />
              <span className="shrink-0 text-right font-semibold tabular-nums">
                {formatearPesos(l.total)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
