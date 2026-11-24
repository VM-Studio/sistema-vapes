"use client";

import { useEffect, useState } from "react";

import { origenesClienteAction } from "@/app/(app)/p/[slug]/clientes/actions";
import { Select, type SelectProps } from "@/components/ui/select";

export interface OrigenCliente {
  id: string;
  nombre: string;
}

export const ETIQUETA_ORIGEN = "¿De quién viene este cliente?";
export const AYUDA_ORIGEN =
  "Quién trajo al cliente. Si es de un vendedor, sus ventas a este cliente cuentan como de cliente nuevo.";

// Una sola consulta por pestaña: las opciones (dueños y vendedores) casi no cambian.
let cache: Promise<OrigenCliente[]> | null = null;

function cargar(): Promise<OrigenCliente[]> {
  cache ??= origenesClienteAction().then((r) => {
    if (!r.ok) {
      cache = null;
      return [];
    }
    return r.data;
  });
  return cache;
}

/** Opciones de «¿De quién viene?» (null mientras carga). */
export function useOrigenesCliente(): OrigenCliente[] | null {
  const [origenes, setOrigenes] = useState<OrigenCliente[] | null>(null);
  useEffect(() => {
    let vigente = true;
    void cargar().then((o) => {
      if (vigente) setOrigenes(o);
    });
    return () => {
      vigente = false;
    };
  }, []);
  return origenes;
}

export const opcionesOrigen = (origenes: OrigenCliente[] | null) =>
  (origenes ?? []).map((o) => ({ value: o.id, label: o.nombre }));

/** Select controlado de «¿De quién viene este cliente?» (obligatorio). */
export function SelectOrigen({
  valor,
  onCambiar,
  ...props
}: Omit<SelectProps, "options" | "value" | "onChange"> & {
  valor: string;
  onCambiar: (origenId: string) => void;
}) {
  const origenes = useOrigenesCliente();
  return (
    <Select
      label={ETIQUETA_ORIGEN}
      hint={AYUDA_ORIGEN}
      required
      placeholder={origenes ? "Elegí una opción" : "Cargando…"}
      options={opcionesOrigen(origenes)}
      value={valor}
      onChange={(e) => onCambiar(e.target.value)}
      {...props}
    />
  );
}
