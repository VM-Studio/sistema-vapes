"use client";

import { MedioPago } from "@prisma/client";
import { HandCoins, Pencil, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ClienteForm, type ClienteEditable } from "@/components/clientes/cliente-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { formatearPesos } from "@/lib/format";
import { formatearFecha } from "@/lib/utils";

import { pagoACuentaAction } from "../../ventas/actions";
import { ETIQUETA_MEDIO } from "../../ventas/nueva/tipos";
import { darDeBajaClienteAction } from "../actions";

interface Pendiente {
  id: string;
  numero: number;
  fecha: Date;
  total: string;
  saldoPendiente: string;
}

export function AccionesCliente({
  cliente,
  saldoDeudor,
  pendientes,
  puedeEditar,
  puedeEliminar,
  puedeCobrar,
  puedeDefinirLimite,
}: {
  cliente: ClienteEditable;
  saldoDeudor: string;
  pendientes: Pendiente[];
  puedeEditar: boolean;
  puedeEliminar: boolean;
  puedeCobrar: boolean;
  puedeDefinirLimite: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState<"editar" | "pago" | "baja" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function darDeBaja() {
    const r = await darDeBajaClienteAction({ id: cliente.id });
    setAbierto(null);
    if (!r.ok) return toast.error("No se pudo dar de baja", r.error.message);
    toast.success(`${cliente.nombre} dado de baja`);
    router.push("/clientes");
  }

  if (!puedeEditar && !puedeEliminar && !(puedeCobrar && Number(saldoDeudor) > 0)) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {puedeCobrar && Number(saldoDeudor) > 0 && (
        <Button onClick={() => setAbierto("pago")}>
          <HandCoins /> Registrar pago a cuenta
        </Button>
      )}
      {puedeEditar && (
        <Button variant="secondary" onClick={() => setAbierto("editar")}>
          <Pencil /> Editar datos
        </Button>
      )}
      {puedeEliminar && (
        <Button variant="secondary" className="text-danger" onClick={() => setAbierto("baja")}>
          <UserX /> Dar de baja
        </Button>
      )}

      <Sheet
        open={abierto === "editar"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title="Editar cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(null)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="submit" form="form-cliente-detalle" loading={enviando}>
              Guardar
            </Button>
          </>
        }
      >
        {abierto === "editar" && (
          <ClienteForm
            formId="form-cliente-detalle"
            cliente={cliente}
            puedeDefinirLimite={puedeDefinirLimite}
            onEnviando={setEnviando}
            onListo={() => {
              setAbierto(null);
              router.refresh();
            }}
          />
        )}
      </Sheet>

      {abierto === "pago" && (
        <PagoACuenta
          clienteId={cliente.id}
          nombre={cliente.nombre}
          pendientes={pendientes}
          onClose={() => setAbierto(null)}
        />
      )}

      <ConfirmDialog
        open={abierto === "baja"}
        onOpenChange={(o) => !o && setAbierto(null)}
        title={`¿Dar de baja a ${cliente.nombre}?`}
        description="Deja de aparecer en el listado y en el punto de venta. Sus compras se conservan. No se puede si debe plata o tiene saldo a favor."
        confirmLabel="Dar de baja"
        danger
        onConfirm={darDeBaja}
      />
    </div>
  );
}

/** Pago a cuenta: se imputa a las ventas elegidas, de la más vieja a la más nueva. */
function PagoACuenta({
  clienteId,
  nombre,
  pendientes,
  onClose,
}: {
  clienteId: string;
  nombre: string;
  pendientes: Pendiente[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [elegidas, setElegidas] = useState<Set<string>>(() => new Set(pendientes.map((p) => p.id)));
  const maximo = pendientes
    .filter((p) => elegidas.has(p.id))
    .reduce((a, p) => a + Number(p.saldoPendiente), 0);
  const [monto, setMonto] = useState(String(maximo));
  const [medio, setMedio] = useState<MedioPago>(MedioPago.EFECTIVO);
  const [referencia, setReferencia] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string>();

  function alternar(id: string, on: boolean) {
    const nuevas = new Set(elegidas);
    if (on) nuevas.add(id);
    else nuevas.delete(id);
    setElegidas(nuevas);
    setMonto(
      String(
        pendientes
          .filter((p) => nuevas.has(p.id))
          .reduce((a, p) => a + Number(p.saldoPendiente), 0),
      ),
    );
  }

  async function enviar() {
    if (Number(monto.replace(",", ".")) > maximo + 0.001)
      return setError(`Máximo ${formatearPesos(maximo)} (lo pendiente de las ventas elegidas)`);
    setEnviando(true);
    const r = await pagoACuentaAction({
      clienteId,
      medioPago: medio,
      monto,
      referencia,
      ventaIds: pendientes.filter((p) => elegidas.has(p.id)).map((p) => p.id),
    });
    setEnviando(false);
    if (!r.ok) {
      setError(r.error.fields?.monto?.[0]);
      if (!r.error.fields?.monto) toast.error("No se pudo registrar el pago", r.error.message);
      return;
    }
    toast.success(
      `Pago de ${formatearPesos(monto)} registrado`,
      `${r.data.imputaciones.map((i) => `#${i.numero}: ${formatearPesos(i.monto)}`).join(" · ")}. Debe ${formatearPesos(r.data.saldoDeudor)}.`,
    );
    onClose();
    router.refresh();
  }

  const medios = Object.values(MedioPago).filter((m) => m !== MedioPago.CREDITO_CLIENTE);
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Pago a cuenta de ${nombre}`}
      description="Se imputa a las ventas elegidas, de la más vieja a la más nueva."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void enviar()} loading={enviando} disabled={elegidas.size === 0}>
            Registrar pago
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Ventas pendientes</legend>
          {pendientes.map((p) => (
            <Checkbox
              key={p.id}
              checked={elegidas.has(p.id)}
              onChange={(e) => alternar(p.id, e.target.checked)}
              label={
                <span className="flex flex-1 justify-between gap-3">
                  <span>
                    Venta #{p.numero}{" "}
                    <span className="text-muted text-xs">· {formatearFecha(p.fecha)}</span>
                  </span>
                  <span className="text-danger font-semibold tabular-nums">
                    {formatearPesos(p.saldoPendiente)}
                  </span>
                </span>
              }
            />
          ))}
        </fieldset>
        <Select
          label="Medio de pago"
          options={medios.map((m) => ({ value: m, label: ETIQUETA_MEDIO[m] }))}
          value={medio}
          onChange={(e) => setMedio(e.target.value as MedioPago)}
        />
        <Input
          label="Monto"
          inputMode="decimal"
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))}
          error={error}
          hint={`Hasta ${formatearPesos(maximo)}`}
        />
        {(medio === MedioPago.TRANSFERENCIA || medio === MedioPago.MERCADOPAGO) && (
          <Input
            label="N.º de operación (opcional)"
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
          />
        )}
      </div>
    </Sheet>
  );
}
