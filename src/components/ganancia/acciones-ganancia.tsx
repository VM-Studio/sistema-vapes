"use client";

import { MedioPago } from "@prisma/client";
import { Banknote, Calculator, RefreshCw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
  generarLiquidacionAction,
  guardarTarifasAction,
  quitarTarifasAction,
  registrarPagoLiquidacionAction,
} from "@/app/(app)/p/[slug]/equipo/[usuarioId]/actions";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { ETIQUETA_CATEGORIA, type Tarifas } from "@/lib/ganancia-vendedor";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

const MEDIOS = Object.values(MedioPago).map((m) => ({ value: m, label: ETIQUETA_MEDIO_PAGO[m] }));

/** "1500.00" → "1500"; null → "". */
const aTexto = (v: string | null | undefined) => (v == null ? "" : String(Number(v)));

/** "1.500,50" → "1500.50"; "1500.5" queda igual. */
const normalizarMonto = (v: string) =>
  v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v.trim();

const primerError = (fields?: Record<string, string[]>) =>
  Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, v[0] ?? ""]));

/** Dueños: cargar o cambiar la ganancia por vape del vendedor (4 categorías). */
export function TarifasDialog({
  usuarioId,
  nombre,
  tarifas,
  variante = "secondary",
}: {
  usuarioId: string;
  nombre: string;
  tarifas: Tarifas | null;
  variante?: "primary" | "secondary" | "ghost";
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const inicial = {
    minorista: aTexto(tarifas?.minorista),
    mayorista: aTexto(tarifas?.mayorista),
    minoristaNuevo: aTexto(tarifas?.minoristaNuevo),
    mayoristaNuevo: aTexto(tarifas?.mayoristaNuevo),
  };
  const [valores, setValores] = useState(inicial);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const limpio = Object.fromEntries(
      Object.entries(valores).map(([k, v]) => [k, normalizarMonto(v)]),
    );
    const r = await guardarTarifasAction({ usuarioId, ...limpio });
    setGuardando(false);
    if (!r.ok) {
      setErrores(primerError(r.error.fields));
      return toast.error("No se pudo guardar", r.error.fields ? undefined : r.error.message);
    }
    setErrores({});
    toast.success("Ganancia por vape guardada");
    setAbierto(false);
    router.refresh();
  }

  async function quitar() {
    setGuardando(true);
    const r = await quitarTarifasAction({ usuarioId });
    setGuardando(false);
    if (!r.ok) return toast.error("No se pudo quitar", r.error.message);
    toast.success("Se quitó la ganancia por vape");
    setAbierto(false);
    router.refresh();
  }

  const campos = [
    ["minorista", ETIQUETA_CATEGORIA.MINORISTA],
    ["mayorista", ETIQUETA_CATEGORIA.MAYORISTA],
    ["minoristaNuevo", ETIQUETA_CATEGORIA.MINORISTA_NUEVO],
    ["mayoristaNuevo", ETIQUETA_CATEGORIA.MAYORISTA_NUEVO],
  ] as const;

  return (
    <>
      <Button
        variant={variante}
        onClick={() => {
          setValores(inicial);
          setErrores({});
          setAbierto(true);
        }}
      >
        <Settings2 strokeWidth={1.75} aria-hidden />
        {tarifas ? "Ganancia por vape" : "Configurar ganancia por vape"}
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        title={`Ganancia por vape de ${nombre}`}
        description="Cuánto gana por cada vape vendido, según el tipo de venta y si el cliente es nuevo (se dio de alta con esa venta). Cambia el mes en curso y los que todavía no se liquidaron."
      >
        <form onSubmit={guardar} className="flex flex-col gap-4" aria-label="Ganancia por vape">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {campos.map(([k, label]) => (
              <Input
                key={k}
                label={`${label} ($ por vape)`}
                inputMode="decimal"
                placeholder="0"
                value={valores[k]}
                onChange={(e) => setValores((v) => ({ ...v, [k]: e.target.value }))}
                error={errores[k]}
              />
            ))}
          </div>
          <div className="flex flex-col-reverse gap-3 pt-1 md:flex-row md:items-center md:justify-between">
            {tarifas ? (
              <Button variant="ghost" onClick={() => void quitar()} disabled={guardando}>
                Quitar ganancia por vape
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-col-reverse gap-3 md:flex-row">
              <Button variant="secondary" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={guardando}>
                Guardar
              </Button>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Dueños: generar (o recalcular, si sigue pendiente) la liquidación de un mes terminado. */
export function GenerarLiquidacion({
  usuarioId,
  mes,
  recalcular = false,
}: {
  usuarioId: string;
  mes: string;
  recalcular?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  async function generar() {
    setEnviando(true);
    const r = await generarLiquidacionAction({ usuarioId, mes });
    setEnviando(false);
    if (!r.ok) return toast.error("No se pudo generar la liquidación", r.error.message);
    toast.success(r.data.creada ? "Liquidación generada" : "Liquidación recalculada");
    router.refresh();
  }
  return (
    <Button
      variant={recalcular ? "ghost" : "primary"}
      onClick={() => void generar()}
      loading={enviando}
    >
      {recalcular ? (
        <RefreshCw strokeWidth={1.75} aria-hidden />
      ) : (
        <Calculator strokeWidth={1.75} aria-hidden />
      )}
      {recalcular ? "Recalcular" : "Generar liquidación"}
    </Button>
  );
}

/** Dueños: registrar el pago de la liquidación (monto precargado con el total). */
export function RegistrarPago({
  liquidacionId,
  nombre,
  mesLabel,
  total,
}: {
  liquidacionId: string;
  nombre: string;
  mesLabel: string;
  total: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(aTexto(total));
  const [medioPago, setMedio] = useState<string>(MedioPago.EFECTIVO);
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(hoyAR());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    const r = await registrarPagoLiquidacionAction({
      id: liquidacionId,
      monto: normalizarMonto(monto),
      medioPago,
      referencia,
      fecha,
    });
    setEnviando(false);
    if (!r.ok) {
      setErrores(primerError(r.error.fields));
      return toast.error(
        "No se pudo registrar el pago",
        r.error.fields ? undefined : r.error.message,
      );
    }
    toast.success("Pago registrado", formatearPesos(r.data.monto));
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setAbierto(true)}>
        <Banknote strokeWidth={1.75} aria-hidden /> Registrar pago
      </Button>
      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title={`Pago a ${nombre}`}
        description={`Liquidación de ${mesLabel}: le corresponden ${formatearPesos(total)}.`}
        footer={
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void confirmar()} loading={enviando}>
              Confirmar pago
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Monto pagado"
            inputMode="decimal"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            error={errores.monto}
          />
          <Select
            label="Cómo se le pagó"
            options={MEDIOS}
            value={medioPago}
            onChange={(e) => setMedio(e.target.value)}
            error={errores.medioPago}
          />
          <Input
            label="Fecha del pago"
            type="date"
            value={fecha}
            max={hoyAR()}
            onChange={(e) => setFecha(e.target.value)}
            error={errores.fecha}
          />
          <Input
            label="Referencia (opcional)"
            value={referencia}
            maxLength={200}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="N.º de transferencia, recibo…"
            error={errores.referencia}
          />
        </div>
      </Sheet>
    </>
  );
}
