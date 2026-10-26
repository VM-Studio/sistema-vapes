"use client";

import { PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { recibirCompraAction, preciosQueCambianAction } from "@/app/(app)/p/[slug]/compras/actions";
import { DialogoRecibir } from "@/components/compras/dialogo-recibir";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { invalidarResoluciones } from "@/features/scanner/resolver-codigo";
import { formatearNumero } from "@/lib/format";
import type { CambioPrecioProveedor } from "@/server/services/compra.service";

/**
 * «Recibido»: confirma la llegada de una compra pendiente de recibir. Abre la
 * confirmación (con los precios del proveedor que cambiarían, que pide al
 * abrir si no vienen) y recién ahí ingresa el stock al galpón
 * (recibirCompra: INGRESO_COMPRA, ultimoCosto y, si se elige, precios del
 * proveedor). Lo usan el listado y el detalle de compras.
 */
export function BotonRecibido({
  compraId,
  idVisible,
  unidades,
  deposito,
  proveedor,
  cambios: cambiosIniciales,
  size = "md",
  fullWidth,
  className,
}: {
  compraId: string;
  idVisible: string;
  unidades: number;
  deposito: string;
  proveedor: string;
  /** Si ya se calcularon en el servidor (detalle); si no, se piden al abrir. */
  cambios?: CambioPrecioProveedor[];
  size?: "sm" | "md";
  fullWidth?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [cambios, setCambios] = useState<CambioPrecioProveedor[] | null>(cambiosIniciales ?? null);
  const [enviando, setEnviando] = useState(false);

  async function abrir() {
    setAbierto(true);
    if (cambiosIniciales) return setCambios(cambiosIniciales);
    setCambios(null);
    const r = await preciosQueCambianAction({ id: compraId });
    if (!r.ok) {
      setAbierto(false);
      toast.error("No se pudieron comparar los precios", r.error.message);
      return;
    }
    setCambios(r.data);
  }

  async function recibir(actualizarPrecioProveedor: boolean) {
    setEnviando(true);
    const r = await recibirCompraAction({ id: compraId, actualizarPrecioProveedor });
    setEnviando(false);
    setAbierto(false);
    if (!r.ok) return toast.error("No se pudo marcar como recibida", r.error.message);
    invalidarResoluciones();
    toast.success(
      `Compra ${idVisible} recibida`,
      `Ingresaron ${formatearNumero(r.data.unidades)} unidades a ${deposito}${r.data.preciosActualizados ? ` · ${r.data.preciosActualizados} precio(s) de ${proveedor} actualizado(s)` : ""}.`,
    );
    router.refresh();
  }

  return (
    <>
      <Button
        size={size}
        fullWidth={fullWidth}
        className={className}
        onClick={() => void abrir()}
        aria-label={`Recibido: compra ${idVisible}`}
      >
        <PackageCheck strokeWidth={1.75} /> Recibido
      </Button>
      <DialogoRecibir
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        proveedor={proveedor}
        deposito={deposito}
        unidades={unidades}
        cambios={cambios}
        enviando={enviando}
        onConfirmar={(a) => void recibir(a)}
      />
    </>
  );
}
