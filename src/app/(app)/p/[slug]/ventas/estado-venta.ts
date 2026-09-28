"use client";

import type { MedioPago } from "@prisma/client";
import { useEffect, useState } from "react";

import type { ClienteElegido } from "@/components/clientes/selector-cliente";

/** Pasos del modal "Generar venta" (el éxito se muestra aparte). */
export const PASOS = ["galpon", "productos", "cliente", "pago"] as const;
export type Paso = (typeof PASOS)[number];

export const ETIQUETA_PASO: Record<Paso, string> = {
  galpon: "Galpón",
  productos: "Productos",
  cliente: "Cliente",
  pago: "Pago",
};

export interface ItemVenta {
  varianteId: string;
  productoId: string;
  /** "Elf Bar BC 5000 — Mango Ice". */
  titulo: string;
  /** Precio de lista del sabor (el servidor lo vuelve a leer al confirmar). */
  precioLista: string;
  cantidad: number;
  /** Solo con permiso "editar" en VENTAS. */
  precioEspecial: string | null;
}

/** Lo que se guarda en localStorage para "Retomar venta en curso". */
export interface VentaEnCurso {
  paso: Paso;
  depositoId: string | null;
  items: ItemVenta[];
  cliente: ClienteElegido | null;
  medioPago: MedioPago | null;
  /** Descuento global en pesos, tal como se tipeó ("" = sin descuento). */
  descuento: string;
  notas: string;
}

export const ventaVacia = (depositoId: string | null = null): VentaEnCurso => ({
  paso: "galpon",
  depositoId,
  items: [],
  cliente: null,
  medioPago: null,
  descuento: "",
  notas: "",
});

/** ¿Hay algo que se perdería al cerrar? */
export const ventaTieneDatos = (v: VentaEnCurso) => v.items.length > 0 || v.cliente !== null;

/** Una venta en curso por panel y por usuario (cada vendedor la suya). */
export const claveVentaEnCurso = (slug: string, usuarioId: string) =>
  `ventas.enCurso.${slug}.${usuarioId}`;

export function leerVentaEnCurso(clave: string): VentaEnCurso | null {
  try {
    const crudo = localStorage.getItem(clave);
    if (!crudo) return null;
    const v = JSON.parse(crudo) as Partial<VentaEnCurso>;
    if (!v || !Array.isArray(v.items) || !PASOS.includes(v.paso as Paso)) return null;
    return { ...ventaVacia(), ...v } as VentaEnCurso;
  } catch {
    return null;
  }
}

export function guardarVentaEnCurso(clave: string, v: VentaEnCurso | null): void {
  try {
    if (v === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(v));
  } catch {
    // Modo privado o sin espacio: la venta sigue, solo que no se puede retomar.
  }
}

/** "16000.00" → 1600000 centavos (los totales del modal se suman en enteros). */
export const aCentavos = (monto: string | number) => Math.round(Number(monto) * 100);
export const deCentavos = (c: number) => (c / 100).toFixed(2);

/** "10.000" / "10000,50" / "10000.5" → "10000.50"; null si no es un monto válido. */
export function montoTipeado(texto: string): string | null {
  const t = texto.trim();
  if (!t) return null;
  const normal = t.includes(",")
    ? t.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(t)
      ? t.replace(/\./g, "")
      : t;
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return null;
  return Number(normal).toFixed(2);
}

export const precioCobrado = (i: ItemVenta) => i.precioEspecial ?? i.precioLista;

export function totalesVenta(items: ItemVenta[], descuento: string) {
  const subtotal = items.reduce((a, i) => a + aCentavos(precioCobrado(i)) * i.cantidad, 0);
  const desc = Math.min(aCentavos(montoTipeado(descuento) ?? 0), subtotal);
  return {
    unidades: items.reduce((a, i) => a + i.cantidad, 0),
    subtotal: deCentavos(subtotal),
    descuento: deCentavos(desc),
    total: deCentavos(subtotal - desc),
  };
}

/** Sin red no se vende: el stock y el pago se validan en el servidor en el momento. */
export const MENSAJE_SIN_CONEXION =
  "Las ventas necesitan conexión para validar stock y registrar el pago";

/** Estado de la conexión (navigator.onLine + eventos online/offline). */
export function useEnLinea(): boolean {
  const [enLinea, setEnLinea] = useState(true);
  useEffect(() => {
    const actualizar = () => setEnLinea(navigator.onLine);
    actualizar();
    window.addEventListener("online", actualizar);
    window.addEventListener("offline", actualizar);
    return () => {
      window.removeEventListener("online", actualizar);
      window.removeEventListener("offline", actualizar);
    };
  }, []);
  return enLinea;
}
