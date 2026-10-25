"use client";

import type { MedioPago } from "@prisma/client";
import { HandCoins, type LucideIcon, Plus, ShoppingBag, Split, X } from "lucide-react";

import type { ClienteElegido } from "@/components/clientes/selector-cliente";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import { formatearPesos } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ETIQUETA_MEDIO_PAGO, MEDIOS_PAGO } from "@/lib/ventas-ui";

import { ICONO_MEDIO_PAGO } from "./_componentes/medio-pago";
import {
  aCentavos,
  cambiarMontoFila,
  deCentavos,
  filasIniciales,
  MAX_FILAS_PAGO,
  medioLibre,
  montoTipeado,
  precioCobrado,
  type FilaPago,
  type ItemVenta,
  type ResumenPago,
  type VentaEnCurso,
} from "./estado-venta";

type EstadoPago = Pick<VentaEnCurso, "medioPago" | "dividido" | "pagos" | "fiar">;

/** Botón «Fiado» elegido: sin medio ni filas, todo el total queda en la cuenta corriente. */
export const esFiadoTotal = (p: EstadoPago) => !p.dividido && p.medioPago === null && p.fiar;

/**
 * Paso 4 "¿Cómo paga?": tocar un medio = un pago por el total. Quien tiene
 * FIADOS "crear" ve además el botón «Fiado» (sin pagos: todo el total queda en
 * su cuenta corriente); sin ese permiso el botón no existe. "Dividir pago"
 * abre filas medio + monto + referencia (hasta 3, sin repetir medio) con el
 * restante precargado. Si lo pagado no cubre el total, quien tiene FIADOS
 * "crear" puede "Fiar el resto"; sin ese permiso no se puede confirmar.
 * Si se cobra por Mercado Libre (medio principal), se carga a mano el precio
 * por unidad de cada producto (obligatorio): el total sale de la suma.
 */
export function PasoPago({
  deposito,
  cliente,
  items,
  pago,
  resumenPago,
  medios = MEDIOS_PAGO,
  puedeFiar,
  descuento,
  notas,
  puedeEditar,
  bloqueado = false,
  ml = null,
  totales,
  onPago,
  onPrecioML,
  onDescuento,
  onNotas,
  escaneoRemoto = null,
}: {
  deposito: string;
  cliente: ClienteElegido;
  items: ItemVenta[];
  pago: EstadoPago;
  /** resumirPago(pago, total): lo calcula el modal (también lo usa para confirmar). */
  resumenPago: ResumenPago;
  /** Medios habilitados, en el orden de los botones. */
  medios?: readonly MedioPago[];
  /** FIADOS "crear": puede dejar saldo pendiente (y ve el botón «Fiado»). */
  puedeFiar: boolean;
  descuento: string;
  notas: string;
  puedeEditar: boolean;
  /** Venta desde una cotización: sin descuento ni notas editables (precios cotizados). */
  bloqueado?: boolean;
  /**
   * Se cobra por Mercado Libre: precios a mano por varianteId (tal como se
   * tipearon), los que faltan y el precio ML guardado como sugerencia. null = no aplica.
   */
  ml?: PreciosML | null;
  totales: { unidades: number; subtotal: string; descuento: string; total: string };
  onPago: (p: Partial<EstadoPago>) => void;
  onPrecioML?: (varianteId: string, precio: string) => void;
  onDescuento: (d: string) => void;
  onNotas: (n: string) => void;
  /** Galpón con escaneo remoto: «Escanea Charly» (opcional). null = no aplica. */
  escaneoRemoto?: {
    activo: boolean;
    /** Ya se verificó todo con la pistola: no hace falta. */
    verificada: boolean;
    onCambiar: (activo: boolean) => void;
  } | null;
}) {
  const descuentoInvalido = descuento.trim() !== "" && montoTipeado(descuento) === null;
  const descuentoExcede =
    !descuentoInvalido &&
    descuento.trim() !== "" &&
    aCentavos(montoTipeado(descuento) ?? 0) > aCentavos(totales.subtotal);
  const pendiente = Number(resumenPago.pendiente) > 0;
  const noCubre = pago.dividido && pendiente && resumenPago.error === null;
  const fiadoTotal = puedeFiar && esFiadoTotal(pago);
  const columnas = medios.length + (puedeFiar ? 1 : 0);

  function cambiarFila(i: number, cambio: Partial<FilaPago>) {
    onPago({ pagos: pago.pagos.map((f, j) => (j === i ? { ...f, ...cambio } : f)) });
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4">
        <fieldset className="flex flex-col">
          <legend className="text-h2 mb-4 font-semibold">¿Cómo paga?</legend>
          <div
            role="radiogroup"
            aria-label="Medio de pago"
            className={cn(
              "grid gap-2",
              columnas >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3",
            )}
          >
            {medios.map((m) => (
              <BotonMedio
                key={m}
                icono={ICONO_MEDIO_PAGO[m]}
                etiqueta={ETIQUETA_MEDIO_PAGO[m]}
                activo={!pago.dividido && pago.medioPago === m}
                onClick={() => onPago({ medioPago: m, dividido: false, fiar: false })}
              />
            ))}
            {puedeFiar && (
              <BotonMedio
                icono={HandCoins}
                etiqueta="Fiado"
                activo={fiadoTotal}
                onClick={() => onPago({ medioPago: null, dividido: false, fiar: true, pagos: [] })}
              />
            )}
          </div>
          {!pago.dividido && (
            <Button
              variant="secondary"
              className="mt-2 self-start"
              onClick={() =>
                onPago({
                  dividido: true,
                  fiar: false,
                  pagos: filasIniciales(pago.medioPago, totales.total, medios),
                })
              }
            >
              <Split strokeWidth={1.75} /> Dividir pago
            </Button>
          )}
        </fieldset>

        {ml && (
          <PreciosManualesML
            items={items}
            ml={ml}
            onPrecio={(id, precio) => onPrecioML?.(id, precio)}
          />
        )}

        {pago.dividido && (
          <section
            aria-label="Pago dividido"
            className="bg-card rounded-card flex flex-col gap-4 p-4 md:p-5"
            data-testid="pago-dividido"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-h3 font-semibold">Pago dividido</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPago({ dividido: false, fiar: false, pagos: [] })}
              >
                Un solo medio
              </Button>
            </div>
            <ul className="flex flex-col gap-3">
              {pago.pagos.map((f, i) => {
                const usados = new Set(
                  pago.pagos.filter((_, j) => j !== i).map((x) => x.medioPago),
                );
                const montoInvalido = f.monto.trim() !== "" && montoTipeado(f.monto) === null;
                return (
                  <li
                    key={i}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-2 md:grid-cols-[10rem_9rem_minmax(0,1fr)_auto]"
                    data-testid={`fila-pago-${i}`}
                  >
                    <Select
                      aria-label={`Medio del pago ${i + 1}`}
                      value={f.medioPago}
                      onChange={(e) => cambiarFila(i, { medioPago: e.target.value as MedioPago })}
                      options={medios.map((m) => ({
                        value: m,
                        label: ETIQUETA_MEDIO_PAGO[m],
                        disabled: usados.has(m),
                      }))}
                    />
                    <Input
                      aria-label={`Monto del pago ${i + 1}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={f.monto}
                      onChange={(e) =>
                        onPago({
                          pagos: cambiarMontoFila(
                            pago.pagos,
                            i,
                            e.target.value,
                            totales.total,
                            medios,
                          ),
                        })
                      }
                      error={montoInvalido ? "Monto inválido" : undefined}
                      className="tabular-nums"
                    />
                    <Input
                      aria-label={`Referencia del pago ${i + 1}`}
                      placeholder="Referencia (opcional)"
                      maxLength={100}
                      value={f.referencia}
                      onChange={(e) => cambiarFila(i, { referencia: e.target.value })}
                      containerClassName="col-span-2 row-start-2 md:col-span-1 md:row-start-auto"
                    />
                    {i > 0 ? (
                      <IconButton
                        aria-label={`Quitar el pago ${i + 1}`}
                        onClick={() => onPago({ pagos: pago.pagos.filter((_, j) => j !== i) })}
                        className="col-start-3 row-start-1 md:col-start-auto md:row-start-auto"
                      >
                        <X strokeWidth={1.75} />
                      </IconButton>
                    ) : (
                      <span className="size-11 md:size-10" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ul>
            {pago.pagos.length < MAX_FILAS_PAGO && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  const medio = medioLibre(pago.pagos, null, medios);
                  if (!medio) return;
                  onPago({
                    pagos: [
                      ...pago.pagos,
                      {
                        medioPago: medio,
                        monto: pendiente ? resumenPago.pendiente : "",
                        referencia: "",
                      },
                    ],
                  });
                }}
              >
                <Plus strokeWidth={1.75} /> Agregar otro medio
              </Button>
            )}
            <p className="border-border text-small border-t pt-3" data-testid="control-pago">
              Pagado <strong className="tabular-nums">{formatearPesos(resumenPago.pagado)}</strong>{" "}
              de <span className="tabular-nums">{formatearPesos(totales.total)}</span>
              {Number(resumenPago.vuelto) > 0 && (
                <>
                  {" · "}Vuelto{" "}
                  <strong className="tabular-nums">{formatearPesos(resumenPago.vuelto)}</strong>
                </>
              )}
            </p>
            {resumenPago.error && (
              <p role="alert" className="text-danger text-small">
                {resumenPago.error}
              </p>
            )}
            {noCubre &&
              (puedeFiar ? (
                <Switch
                  label="Fiar el resto"
                  hint={`Queda en la cuenta corriente de ${cliente.nombre}.`}
                  checked={pago.fiar}
                  onCheckedChange={(fiar) => onPago({ fiar })}
                />
              ) : (
                <p role="alert" className="text-danger text-small" data-testid="pago-no-cubre">
                  El pago no cubre el total
                </p>
              ))}
            {noCubre && puedeFiar && pago.fiar && (
              <p
                role="status"
                className="bg-surface-3 text-foreground rounded-control flex items-center gap-2 px-3 py-2.5 text-sm"
                data-testid="queda-pendiente"
              >
                <HandCoins className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>
                  Queda pendiente{" "}
                  <strong className="tabular-nums">{formatearPesos(resumenPago.pendiente)}</strong>{" "}
                  a cuenta de {cliente.nombre}
                </span>
              </p>
            )}
          </section>
        )}

        {!bloqueado && (
          <div className="bg-card rounded-card flex flex-col gap-4 p-4 md:p-5">
            {puedeEditar && (
              <Input
                label="Descuento ($)"
                inputMode="decimal"
                placeholder="0"
                value={descuento}
                onChange={(e) => onDescuento(e.target.value)}
                error={
                  descuentoInvalido
                    ? "Monto inválido"
                    : descuentoExcede
                      ? `Máximo ${formatearPesos(totales.subtotal)}`
                      : undefined
                }
                className="tabular-nums"
              />
            )}

            <Textarea
              label="Notas (opcional)"
              rows={2}
              maxLength={2000}
              value={notas}
              onChange={(e) => onNotas(e.target.value)}
            />
          </div>
        )}

        {escaneoRemoto && (
          <div className="bg-card rounded-card p-4 md:p-5" data-testid="escaneo-remoto">
            <Switch
              label={`Escanea ${NOMBRE_ESCANEO}`}
              hint={
                escaneoRemoto.verificada
                  ? "Ya verificaste todo con la pistola: no hace falta."
                  : `${NOMBRE_ESCANEO} escanea los vapes en ${deposito} y te avisa cuando están listos para retirar.`
              }
              checked={escaneoRemoto.activo}
              disabled={escaneoRemoto.verificada}
              onCheckedChange={escaneoRemoto.onCambiar}
            />
          </div>
        )}
      </div>

      <section
        aria-label="Resumen de la venta"
        className="bg-card rounded-card flex flex-col gap-3 self-start p-4 md:p-5"
      >
        <h3 className="text-h3 font-semibold">Resumen</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Galpón</dt>
          <dd className="text-right font-medium">{deposito}</dd>
          <dt className="text-muted">Cliente</dt>
          <dd className="text-right font-medium">
            {cliente.nombre}
            {cliente.tipo === "nuevo" && <span className="text-muted font-normal"> (nuevo)</span>}
          </dd>
          {resumenPago.pagos.map((p) => (
            <div key={p.medioPago} className="contents">
              <dt className="text-muted">{ETIQUETA_MEDIO_PAGO[p.medioPago]}</dt>
              <dd className="text-right font-medium tabular-nums">
                {pago.dividido ? formatearPesos(p.monto) : "Por el total"}
              </dd>
            </div>
          ))}
          {Number(resumenPago.vuelto) > 0 && (
            <>
              <dt className="text-muted">Vuelto</dt>
              <dd className="text-right tabular-nums">{formatearPesos(resumenPago.vuelto)}</dd>
            </>
          )}
          {fiadoTotal && (
            <>
              <dt className="text-muted">Fiado</dt>
              <dd className="text-right font-medium">Por el total</dd>
            </>
          )}
          {pago.dividido && pendiente && pago.fiar && puedeFiar && (
            <>
              <dt className="text-muted">Pendiente</dt>
              <dd className="text-right font-semibold tabular-nums">
                {formatearPesos(resumenPago.pendiente)}
              </dd>
            </>
          )}
        </dl>
        <ul className="border-border flex flex-col gap-1.5 border-t pt-3 text-sm">
          {items.map((i) => (
            <li key={i.varianteId} className="flex justify-between gap-3">
              <span className="min-w-0">
                {i.cantidad} × {i.titulo}
                {ml && <span className="text-muted block text-xs">Precio Mercado Libre</span>}
                {i.precioEspecial !== null && (
                  <span className="text-muted block text-xs">
                    {bloqueado ? "Precio cotizado" : "Precio especial"}{" "}
                    {formatearPesos(i.precioEspecial)}
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatearPesos(deCentavos(aCentavos(precioCobrado(i)) * i.cantidad))}
              </span>
            </li>
          ))}
        </ul>
        <dl className="border-border grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-3 text-sm">
          <dt className="text-muted">Subtotal</dt>
          <dd className="text-right tabular-nums">{formatearPesos(totales.subtotal)}</dd>
          {Number(totales.descuento) > 0 && (
            <>
              <dt className="text-muted">Descuento</dt>
              <dd className="text-right tabular-nums">−{formatearPesos(totales.descuento)}</dd>
            </>
          )}
          <dt className="text-h3 font-semibold">Total</dt>
          <dd className="text-h3 text-right font-semibold tabular-nums">
            {formatearPesos(totales.total)}
          </dd>
        </dl>
        {fiadoTotal && pendiente && (
          <p
            role="status"
            className="bg-surface-3 text-foreground rounded-control flex items-center gap-2 px-3 py-2.5 text-sm"
            data-testid="venta-fiada"
          >
            <HandCoins className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            <span>
              Esta venta queda fiada a {cliente.nombre} por{" "}
              <strong className="tabular-nums">{formatearPesos(resumenPago.pendiente)}</strong>
            </span>
          </p>
        )}
      </section>
    </div>
  );
}

export interface PreciosML {
  /** Precio por unidad tipeado, por varianteId. */
  precios: Record<string, string>;
  /** varianteId sin precio válido (> 0). */
  faltan: string[];
  /** Precio ML guardado en el producto (dato viejo): solo placeholder. */
  sugerencias: Record<string, string | null>;
}

/**
 * Venta cobrada por Mercado Libre: un input de precio por unidad por producto
 * (obligatorio), con el subtotal de cada uno y el total en vivo. No se puede
 * confirmar hasta que estén todos.
 */
function PreciosManualesML({
  items,
  ml,
  onPrecio,
}: {
  items: ItemVenta[];
  ml: PreciosML;
  onPrecio: (varianteId: string, precio: string) => void;
}) {
  const faltan = new Set(ml.faltan);
  const total = items.reduce((a, i) => a + aCentavos(i.precioLista) * i.cantidad, 0);
  return (
    <section
      aria-label="Precios Mercado Libre"
      className="bg-card rounded-card flex flex-col gap-4 p-4 md:p-5"
      data-testid="precios-ml"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-h3 flex items-center gap-2 font-semibold">
          <ShoppingBag className="text-muted size-5 shrink-0" strokeWidth={1.75} aria-hidden />
          Precios Mercado Libre
        </h3>
        <p className="text-muted text-small">
          Cargá el precio por unidad de cada producto, tal como se vendió en Mercado Libre.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {items.map((i) => {
          const tipeado = ml.precios[i.varianteId] ?? "";
          const invalido = tipeado.trim() !== "" && faltan.has(i.varianteId);
          const sugerido = ml.sugerencias[i.varianteId];
          return (
            <li
              key={i.varianteId}
              className="grid grid-cols-[minmax(0,1fr)_9rem] items-start gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1fr)_10rem_7rem]"
              data-testid="precio-ml-item"
            >
              <span className="min-w-0 pt-2.5 text-sm">
                <span className="font-medium">{i.titulo}</span>
                <span className="text-muted block text-xs">
                  {i.cantidad} {i.cantidad === 1 ? "unidad" : "unidades"}
                </span>
              </span>
              <Input
                aria-label={`Precio Mercado Libre de ${i.titulo}`}
                inputMode="decimal"
                placeholder={sugerido ? formatearPesos(sugerido) : "$ por unidad"}
                value={tipeado}
                onChange={(e) => onPrecio(i.varianteId, e.target.value)}
                error={invalido ? "Precio inválido" : undefined}
                className="tabular-nums"
              />
              <span className="text-muted col-span-2 text-right text-sm tabular-nums md:col-span-1 md:pt-2.5">
                {faltan.has(i.varianteId)
                  ? "—"
                  : formatearPesos(deCentavos(aCentavos(i.precioLista) * i.cantidad))}
              </span>
            </li>
          );
        })}
      </ul>
      <p
        className="border-border flex justify-between gap-3 border-t pt-3 text-sm"
        data-testid="total-ml"
      >
        <span className="text-muted">Total Mercado Libre</span>
        <strong className="tabular-nums">{formatearPesos(deCentavos(total))}</strong>
      </p>
      {ml.faltan.length > 0 && (
        <p role="alert" className="text-danger text-small" data-testid="faltan-precios-ml">
          {ml.faltan.length === 1
            ? "Falta el precio de 1 producto."
            : `Falta el precio de ${ml.faltan.length} productos.`}
        </p>
      )}
    </section>
  );
}

/** Botón grande de "¿Cómo paga?": un medio por el total, o «Fiado». */
function BotonMedio({
  icono: Icono,
  etiqueta,
  activo,
  onClick,
}: {
  icono: LucideIcon;
  etiqueta: string;
  activo: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={activo}
      onClick={onClick}
      className={cn(
        "text-body rounded-control flex min-h-14 items-center gap-3 border px-4 text-left font-semibold transition-colors sm:min-h-24 sm:flex-col sm:justify-center sm:text-center",
        activo
          ? "border-foreground bg-foreground text-background"
          : "border-foreground bg-surface text-foreground hover:bg-surface-2",
      )}
    >
      <Icono
        className={cn("size-6", activo ? "text-background" : "text-muted")}
        strokeWidth={1.75}
        aria-hidden
      />
      {etiqueta}
    </button>
  );
}
