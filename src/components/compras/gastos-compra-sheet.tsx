"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { pesosAMoneda, vistaCostosUsdt } from "@/lib/costos-compra";
import { formatearNumero, formatearPesos, formatearUsdt } from "@/lib/format";
import { cn, formatearFechaHora } from "@/lib/utils";
import type { CostosCompra } from "@/server/services/compra.service";

import { textoUsdt } from "./resumen-compra-card";

import {
  agregarGastosCompraAction,
  anularGastoCompraAction,
  obtenerCostosCompraAction,
} from "@/app/(app)/p/[slug]/compras/actions";

interface FilaGasto {
  clave: number;
  motivo: string;
  monto: string;
}

const soloMonto = (s: string) => s.replace(/[^\d.,]/g, "");
const filaVacia = (clave: number): FilaGasto => ({ clave, motivo: "", monto: "" });

/**
 * "Agregar gastos extras" de una compra (valija, envío…): carga filas motivo
 * + monto EN USDT (el servidor lo pasa a pesos con la cotización de la
 * compra) y muestra en vivo, en USDT, cómo queda el costo final (comisión + gastos =
 * recargo por unidad → costo final por unidad). Los dueños anulan gastos ya
 * cargados. Los números definitivos los calcula y guarda el servidor.
 */
export function GastosCompraSheet({
  compraId,
  idVisible,
  abierto,
  onCerrar,
  puedeAnular,
}: {
  compraId: string;
  idVisible: string;
  abierto: boolean;
  onCerrar: () => void;
  puedeAnular: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [datos, setDatos] = useState<CostosCompra | null>(null);
  const [filas, setFilas] = useState<FilaGasto[]>([filaVacia(0)]);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [anulando, setAnulando] = useState<{ id: string; motivo: string } | null>(null);
  const [enviandoAnulacion, setEnviandoAnulacion] = useState(false);

  async function cargar() {
    const r = await obtenerCostosCompraAction({ id: compraId });
    if (!r.ok) {
      toast.error("No se pudieron cargar los costos", r.error.message);
      onCerrar();
      return;
    }
    setDatos(r.data);
  }

  useEffect(() => {
    if (!abierto) return;
    setDatos(null);
    setFilas([filaVacia(0)]);
    setErrores({});
    setAnulando(null);
    void cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarga solo al abrir
  }, [abierto, compraId]);

  const nuevos = filas.filter((f) => f.monto.trim() !== "" || f.motivo.trim() !== "");
  const vigentes = datos?.gastos.filter((g) => !g.anulado) ?? [];
  const cot = datos?.cotizacionUsdt ?? null;
  // Recálculo en vivo EN USDT con la misma función que el servidor.
  const vista =
    datos && cot
      ? vistaCostosUsdt({
          costosEnUsdt: datos.costosEnUsdt,
          tipoCambioUSDT: cot.valor,
          comisionPorcentaje: datos.comisionPasistaPorcentaje,
          descuento: datos.descuento,
          items: datos.items,
          gastos: [
            ...vigentes,
            ...nuevos.map((f) => ({ monto: "", montoUSDT: f.monto.replace(",", ".") || "0" })),
          ],
        })
      : null;
  const calculo = vista?.costos ?? null;
  const usdt = (n: number) => textoUsdt(n, vista?.aproximado ?? false);
  /** Gasto ya cargado en USDT (uno anterior, cargado en pesos: su equivalente). */
  const usdtGasto = (g: { monto: string; montoUSDT: string | null }) =>
    g.montoUSDT
      ? formatearUsdt(g.montoUSDT)
      : cot
        ? textoUsdt(pesosAMoneda(g.monto, cot.valor), true)
        : formatearPesos(g.monto);

  async function guardar() {
    setGuardando(true);
    const r = await agregarGastosCompraAction({
      compraId,
      gastos: nuevos.map((f) => ({ motivo: f.motivo, montoUSDT: f.monto })),
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      toast.error(
        "No se pudieron guardar los gastos",
        r.error.fields ? "Revisá los datos marcados." : r.error.message,
      );
      return;
    }
    toast.success(
      `Gastos cargados en ${r.data.idVisible}`,
      calculo ? `Costo final ${usdt(calculo.costoFinalTotal)}` : undefined,
    );
    router.refresh();
    onCerrar();
  }

  async function confirmarAnulacion() {
    if (!anulando) return;
    setEnviandoAnulacion(true);
    const r = await anularGastoCompraAction({ id: anulando.id, motivo: anulando.motivo });
    setEnviandoAnulacion(false);
    if (!r.ok) {
      toast.error("No se pudo anular el gasto", r.error.fields?.motivo?.[0] ?? r.error.message);
      return;
    }
    toast.success("Gasto anulado");
    setAnulando(null);
    router.refresh();
    await cargar();
  }

  const errorDe = (i: number, campo: "motivo" | "monto") => {
    // Los índices del servidor son sobre `nuevos` (las filas no vacías).
    const n = nuevos.findIndex((f) => f.clave === filas[i]!.clave);
    const clave = campo === "monto" ? "montoUSDT" : campo;
    return n >= 0 ? errores[`gastos.${n}.${clave}`] : undefined;
  };

  return (
    <Sheet
      open={abierto}
      onOpenChange={(o) => !o && onCerrar()}
      title="Agregar gastos extras"
      description={`Compra ${idVisible}: valija, envío y lo que haya costado traerla, en USDT. Se reparten por unidad.`}
      footer={
        <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button
            onClick={() => void guardar()}
            loading={guardando}
            disabled={!datos || nuevos.length === 0 || guardando}
          >
            Guardar gastos
          </Button>
        </div>
      }
    >
      {!datos ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-3" aria-label="Gastos nuevos">
            <h3 className="font-semibold">Nuevos gastos</h3>
            <ul className="flex flex-col gap-3">
              {filas.map((f, i) => (
                <li
                  key={f.clave}
                  className="grid grid-cols-[minmax(0,1fr)_8rem_2.75rem] items-start gap-2"
                >
                  <Input
                    label={i === 0 ? "Motivo" : undefined}
                    aria-label={`Motivo del gasto ${i + 1}`}
                    placeholder="Valija, Envío…"
                    value={f.motivo}
                    maxLength={120}
                    onChange={(e) =>
                      setFilas((fs) =>
                        fs.map((x) => (x.clave === f.clave ? { ...x, motivo: e.target.value } : x)),
                      )
                    }
                    error={errorDe(i, "motivo")}
                  />
                  <Input
                    label={i === 0 ? "Monto (USDT)" : undefined}
                    aria-label={`Monto en USDT del gasto ${i + 1}`}
                    inputMode="decimal"
                    placeholder="0"
                    className="text-right tabular-nums"
                    value={f.monto}
                    onChange={(e) =>
                      setFilas((fs) =>
                        fs.map((x) =>
                          x.clave === f.clave ? { ...x, monto: soloMonto(e.target.value) } : x,
                        ),
                      )
                    }
                    error={errorDe(i, "monto")}
                  />
                  <IconButton
                    variant="ghost"
                    className={cn("hover:text-danger", i === 0 && "mt-7")}
                    aria-label={`Quitar el gasto ${i + 1}`}
                    disabled={filas.length === 1}
                    onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                  >
                    <Trash2 strokeWidth={1.75} />
                  </IconButton>
                </li>
              ))}
            </ul>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setFilas((fs) => [...fs, filaVacia(Math.max(...fs.map((x) => x.clave)) + 1)])
              }
            >
              <Plus strokeWidth={1.75} /> Otro gasto
            </Button>
            {errores.gastos && <p className="text-danger text-small">{errores.gastos}</p>}
          </section>

          {calculo && (
            <section
              aria-label="Recálculo del costo"
              className="bg-surface-2 rounded-card flex flex-col gap-2 p-4 text-sm"
            >
              <Fila label="Total de la compra" texto={usdt(calculo.total)} />
              <Fila
                label={
                  calculo.comisionPorcentaje === null
                    ? "Comisión pasista (sin comisión)"
                    : `Comisión pasista (${formatearNumero(calculo.comisionPorcentaje)}%)`
                }
                texto={usdt(calculo.comision)}
              />
              <Fila label="Gastos extras" texto={usdt(calculo.gastos)} />
              <Fila
                label={`Gastos por unidad (${formatearNumero(calculo.unidades)} u.)`}
                texto={usdt(calculo.gastosPorUnidad)}
              />
              <div className="border-border mt-1 flex items-baseline justify-between gap-3 border-t pt-2">
                <span className="font-semibold">Costo final total</span>
                <strong className="tabular-nums" aria-label="Costo final total">
                  {usdt(calculo.costoFinalTotal)}
                </strong>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">Costo final por unidad (promedio)</span>
                <strong className="text-h3 tabular-nums" aria-label="Costo final por unidad">
                  {usdt(calculo.costoUnitarioFinalPromedio)}
                </strong>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-2" aria-label="Gastos cargados">
            <h3 className="font-semibold">Gastos ya cargados</h3>
            {datos.gastos.length === 0 ? (
              <p className="text-muted text-small">Todavía no tiene gastos extras.</p>
            ) : (
              <ul className="divide-border border-border rounded-card divide-y border">
                {datos.gastos.map((g) => (
                  <li key={g.id} className="flex flex-col gap-2 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate font-medium",
                            g.anulado && "text-subtle line-through",
                          )}
                        >
                          {g.motivo}
                        </span>
                        <span className="text-subtle block text-xs">
                          {formatearFechaHora(g.fecha)} · {g.usuario}
                          {g.anulado && g.motivoAnulacion ? ` · Anulado: ${g.motivoAnulacion}` : ""}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {g.anulado ? (
                          <Badge variant="neutral">Anulado</Badge>
                        ) : (
                          <strong className="tabular-nums">{usdtGasto(g)}</strong>
                        )}
                        {puedeAnular && !g.anulado && anulando?.id !== g.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAnulando({ id: g.id, motivo: "" })}
                          >
                            Anular
                          </Button>
                        )}
                      </span>
                    </div>
                    {anulando?.id === g.id && (
                      <div className="flex flex-col gap-2">
                        <Input
                          label="Motivo de la anulación"
                          value={anulando.motivo}
                          onChange={(e) => setAnulando({ id: g.id, motivo: e.target.value })}
                          placeholder="Ej.: se cargó dos veces"
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setAnulando(null)}>
                            Cancelar
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={enviandoAnulacion}
                            disabled={anulando.motivo.trim().length < 5}
                            onClick={() => void confirmarAnulacion()}
                          >
                            Anular gasto
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Fila({ label, texto }: { label: string; texto: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="whitespace-nowrap tabular-nums">{texto}</span>
    </div>
  );
}

/** Botón secundario "Agregar gastos extras" que abre el Sheet (listado y detalle de compras). */
export function BotonGastosCompra({
  compraId,
  idVisible,
  puedeAnular,
  className,
  size = "sm",
}: {
  compraId: string;
  idVisible: string;
  puedeAnular: boolean;
  className?: string;
  size?: "sm" | "md";
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size={size}
        className={className}
        onClick={() => setAbierto(true)}
        aria-label={`Agregar gastos extras a la compra ${idVisible}`}
      >
        <Plus strokeWidth={1.75} /> Agregar gastos extras
      </Button>
      <GastosCompraSheet
        compraId={compraId}
        idVisible={idVisible}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        puedeAnular={puedeAnular}
      />
    </>
  );
}
