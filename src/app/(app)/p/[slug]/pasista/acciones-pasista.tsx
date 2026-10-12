"use client";

import { MedioPago } from "@prisma/client";
import { CheckCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { hoyAR } from "@/lib/fechas";
import { formatearPesos } from "@/lib/format";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

import { deshacerPagoPasistaAction, marcarPagadasPasistaAction } from "./actions";

const MEDIOS = Object.values(MedioPago).map((m) => ({ value: m, label: ETIQUETA_MEDIO_PAGO[m] }));

/**
 * "Marcar mes como pagado" (todas las pendientes del mes) o "Marcar pagada"
 * (una fila): Sheet con medio, referencia y fecha del pago.
 */
export function MarcarPagado({
  objetivo,
  titulo,
  resumen,
  textoBoton,
  variante = "primary",
  size = "md",
}: {
  objetivo: { mes: string } | { ids: string[] };
  titulo: string;
  /** "3 compras · $ 100.000". */
  resumen: string;
  textoBoton: string;
  variante?: "primary" | "secondary";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [medioPago, setMedio] = useState<string>(MedioPago.EFECTIVO);
  const [referencia, setReferencia] = useState("");
  const [fecha, setFecha] = useState(hoyAR());
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    const r = await marcarPagadasPasistaAction({ ...objetivo, medioPago, referencia, fecha });
    setEnviando(false);
    if (!r.ok) {
      setErrores(
        Object.fromEntries(Object.entries(r.error.fields ?? {}).map(([k, v]) => [k, v[0] ?? ""])),
      );
      toast.error("No se pudo marcar como pagado", r.error.fields ? undefined : r.error.message);
      return;
    }
    toast.success(
      r.data.cantidad === 1
        ? "Comisión marcada como pagada"
        : `${r.data.cantidad} comisiones pagadas`,
      formatearPesos(r.data.total),
    );
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button variant={variante} size={size} onClick={() => setAbierto(true)}>
        <CheckCheck strokeWidth={1.75} /> {textoBoton}
      </Button>
      <Sheet
        open={abierto}
        onOpenChange={setAbierto}
        title={titulo}
        description={resumen}
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
          <Select
            label="Cómo se le pagó"
            options={MEDIOS}
            value={medioPago}
            onChange={(e) => setMedio(e.target.value)}
            error={errores.medioPago}
          />
          <Input
            label="Referencia (opcional)"
            value={referencia}
            maxLength={200}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="N.º de transferencia, recibo…"
            error={errores.referencia}
          />
          <Input
            label="Fecha del pago"
            type="date"
            value={fecha}
            max={hoyAR()}
            onChange={(e) => setFecha(e.target.value)}
            error={errores.fecha}
          />
        </div>
      </Sheet>
    </>
  );
}

/** Vuelve a pendiente una comisión pagada por error (con motivo). */
export function DeshacerPago({ id, etiqueta }: { id: string; etiqueta: string }) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string>();
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    const r = await deshacerPagoPasistaAction({ id, motivo });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.motivo?.[0] ?? r.error.message);
      return;
    }
    toast.success("El pago se deshizo: la comisión vuelve a estar pendiente");
    setAbierto(false);
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)}>
        <Undo2 strokeWidth={1.75} /> Deshacer pago
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={setAbierto}
        title="Deshacer el pago"
        description={`La comisión de ${etiqueta} vuelve a quedar pendiente.`}
        footer={
          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <Button variant="secondary" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirmar()}
              loading={enviando}
              disabled={motivo.trim().length < 5}
            >
              Deshacer pago
            </Button>
          </div>
        }
      >
        <Input
          label="Motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Ej.: se marcó por error"
          error={error}
        />
      </Dialog>
    </>
  );
}
