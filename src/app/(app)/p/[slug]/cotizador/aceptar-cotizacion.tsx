"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SelectorCliente, type ClienteElegido } from "@/components/clientes/selector-cliente";
import { useRutaPanel } from "@/components/layout/panel-context";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { NOMBRE_ESCANEO } from "@/lib/escaneo-remoto";
import { formatearPesos } from "@/lib/format";

import { aceptarCotizacionAction } from "./actions";

export interface GalponAceptar {
  id: string;
  nombre: string;
  esPrincipal: boolean;
  escaneoRemoto: boolean;
}

/**
 * «Aceptada ✓» de una fila del cotizador: el cliente aceptó la cotización. Un
 * modal corto pide el galpón (el principal por defecto), «Escanea Charly» si el
 * galpón lo admite y el cliente si la cotización no tenía; al confirmar se
 * registra la venta (descuenta stock) pendiente de pago.
 */
export function AceptarCotizacion({
  id,
  codigo,
  total,
  conCliente,
  galpones,
}: {
  id: string;
  codigo: string;
  total: string;
  /** La cotización tiene cliente (registrado, o nombre y teléfono para darlo de alta). */
  conCliente: boolean;
  galpones: GalponAceptar[];
}) {
  const router = useRouter();
  const ruta = useRutaPanel();
  const toast = useToast();
  const principal = galpones.find((g) => g.esPrincipal) ?? galpones[0];
  const [abierto, setAbierto] = useState(false);
  const [depositoId, setDepositoId] = useState(principal?.id ?? "");
  const [escanea, setEscanea] = useState(false);
  const [cliente, setCliente] = useState<ClienteElegido | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const galpon = galpones.find((g) => g.id === depositoId);

  function abrir() {
    setDepositoId(principal?.id ?? "");
    setEscanea(false);
    setCliente(null);
    setError(null);
    setAbierto(true);
  }

  async function confirmar() {
    if (!depositoId) return setError("Elegí el galpón.");
    if (!conCliente && !cliente) return setError("Elegí el cliente de la venta.");
    setEnviando(true);
    setError(null);
    const r = await aceptarCotizacionAction({
      id,
      depositoId,
      escaneoRemoto: !!galpon?.escaneoRemoto && escanea,
      ...(conCliente || !cliente
        ? {}
        : {
            cliente:
              cliente.tipo === "existente"
                ? { id: cliente.id }
                : { nombre: cliente.nombre, telefono: cliente.telefono },
          }),
    }).catch(() => null);
    setEnviando(false);
    if (!r) return setError("Sin conexión con el servidor. Probá de nuevo.");
    if (!r.ok) return setError(r.error.message);
    setAbierto(false);
    toast.success(
      `Venta ${r.data.codigo} registrada`,
      `${codigo} aceptada · ${formatearPesos(r.data.total)} pendiente de pago.`,
    );
    router.push(ruta(`/ventas/${r.data.id}`));
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={abrir}
        aria-label={`Marcar ${codigo} como aceptada`}
        data-testid={`aceptar-${codigo}`}
      >
        <Check strokeWidth={2} /> Aceptada
      </Button>
      <Dialog
        open={abierto}
        onOpenChange={(o) => !enviando && setAbierto(o)}
        title={`¿${codigo} aceptada?`}
        description={`Se registra la venta por ${formatearPesos(total)} con los productos y precios de la cotización, se descuenta el stock y queda pendiente de pago.`}
        className="max-w-lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAbierto(false)} disabled={enviando}>
              Volver
            </Button>
            <Button onClick={() => void confirmar()} loading={enviando}>
              <Check strokeWidth={2} /> Registrar venta
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Select
            label="Galpón"
            options={galpones.map((g) => ({
              value: g.id,
              label: g.esPrincipal ? `${g.nombre} (principal)` : g.nombre,
            }))}
            value={depositoId}
            onChange={(e) => {
              setDepositoId(e.target.value);
              setEscanea(false);
            }}
          />
          {galpon?.escaneoRemoto && (
            <Checkbox
              label={`Escanea ${NOMBRE_ESCANEO}`}
              hint={`Opcional: ${NOMBRE_ESCANEO} escanea los vapes en ${galpon.nombre} y te avisa cuando están listos para retirar.`}
              checked={escanea}
              onChange={(e) => setEscanea(e.target.checked)}
            />
          )}
          {!conCliente && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">La cotización no tiene cliente: elegilo.</p>
              <SelectorCliente valor={cliente} onCambiar={setCliente} permitirNuevo />
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="bg-danger-soft text-danger-soft-foreground rounded-control px-3 py-2 text-sm"
            >
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
