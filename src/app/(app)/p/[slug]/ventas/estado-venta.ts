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

/** Una fila de "Dividir pago": medio + monto tipeado + referencia opcional. */
export interface FilaPago {
  medioPago: MedioPago;
  /** Tal como se tipeó ("" = sin monto). */
  monto: string;
  referencia: string;
}

/** Máximo de filas de "Dividir pago" (una por medio, sin repetir). */
export const MAX_FILAS_PAGO = 3;

/** Lo que se guarda en localStorage para "Retomar venta en curso". */
export interface VentaEnCurso {
  paso: Paso;
  depositoId: string | null;
  items: ItemVenta[];
  cliente: ClienteElegido | null;
  /** Pago simple: un solo medio por el total. */
  medioPago: MedioPago | null;
  /** "Dividir pago": se usan las filas en vez del medio simple. */
  dividido: boolean;
  pagos: FilaPago[];
  /** "Fiar el resto": lo que no cubren los pagos queda en la cuenta corriente. */
  fiar: boolean;
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
  dividido: false,
  pagos: [],
  fiar: false,
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

// --- Pagos -------------------------------------------------------------------------

/** Pagos listos para el servidor, con lo pagado, el vuelto y lo que queda pendiente. */
export interface ResumenPago {
  /** Montos aplicados a la venta (el vuelto se descuenta del efectivo; sin filas en 0). */
  pagos: { medioPago: MedioPago; monto: string; referencia?: string }[];
  /** Σ aplicado a la venta. */
  pagado: string;
  /** Efectivo de más que se devuelve (no se registra). */
  vuelto: string;
  pendiente: string;
  error: string | null;
}

/**
 * Pago de la venta en curso contra el total que muestra el modal. Simple: el
 * medio elegido por el total. Dividido: las filas; si suman más que el total,
 * la diferencia es vuelto y sale del efectivo (sin efectivo, es un error).
 */
export function resumirPago(
  v: Pick<VentaEnCurso, "medioPago" | "dividido" | "pagos">,
  total: string,
): ResumenPago {
  const totalC = aCentavos(total);
  if (!v.dividido) {
    const pagos = v.medioPago ? [{ medioPago: v.medioPago, monto: deCentavos(totalC) }] : [];
    return {
      pagos,
      pagado: deCentavos(v.medioPago ? totalC : 0),
      vuelto: "0.00",
      pendiente: deCentavos(v.medioPago ? 0 : totalC),
      error: null,
    };
  }
  let error: string | null = null;
  const filas = v.pagos.map((f) => {
    const m = f.monto.trim() === "" ? "0.00" : montoTipeado(f.monto);
    if (m === null) error = "Hay un monto inválido";
    return { ...f, centavos: aCentavos(m ?? 0) };
  });
  const entregado = filas.reduce((a, f) => a + f.centavos, 0);
  let vuelto = Math.max(0, entregado - totalC);
  const efectivo = filas.find((f) => f.medioPago === "EFECTIVO");
  if (vuelto > 0) {
    if (!efectivo || efectivo.centavos < vuelto) {
      error ??= "Los pagos superan el total";
      vuelto = 0;
    } else efectivo.centavos -= vuelto;
  }
  const pagadoC = Math.min(entregado - vuelto, totalC);
  return {
    pagos: filas
      .filter((f) => f.centavos > 0)
      .map((f) => ({
        medioPago: f.medioPago,
        monto: deCentavos(f.centavos),
        ...(f.referencia.trim() ? { referencia: f.referencia.trim() } : {}),
      })),
    pagado: deCentavos(pagadoC),
    vuelto: deCentavos(vuelto),
    pendiente: deCentavos(Math.max(0, totalC - pagadoC)),
    error,
  };
}

/** Primer medio que todavía no usa ninguna fila. */
export function medioLibre(filas: FilaPago[], preferido?: MedioPago | null): MedioPago | null {
  const usados = new Set(filas.map((f) => f.medioPago));
  if (preferido && !usados.has(preferido)) return preferido;
  return MEDIOS_ORDEN.find((m) => !usados.has(m)) ?? null;
}

const MEDIOS_ORDEN: readonly MedioPago[] = ["EFECTIVO", "TRANSFERENCIA", "BINANCE"];

/** Al abrir "Dividir pago": una fila con el medio elegido (o efectivo) por el total. */
export function filasIniciales(medio: MedioPago | null, total: string): FilaPago[] {
  return [{ medioPago: medio ?? "EFECTIVO", monto: deCentavos(aCentavos(total)), referencia: "" }];
}

/**
 * Cambia el monto de la fila `i`. Si es la última y no se llega al total,
 * aparece otra fila con el restante precargado (hasta 3); si hay una fila
 * después, esa absorbe la diferencia.
 */
export function cambiarMontoFila(
  filas: FilaPago[],
  i: number,
  monto: string,
  total: string,
): FilaPago[] {
  const nuevas = filas.map((f, j) => (j === i ? { ...f, monto } : f));
  const valor = (f: FilaPago) => aCentavos(montoTipeado(f.monto) ?? 0);
  const totalC = aCentavos(total);
  if (i === nuevas.length - 1) {
    const restante = totalC - nuevas.reduce((a, f) => a + valor(f), 0);
    const medio = medioLibre(nuevas);
    if (restante > 0 && nuevas.length < MAX_FILAS_PAGO && medio && montoTipeado(monto) !== null) {
      nuevas.push({ medioPago: medio, monto: deCentavos(restante), referencia: "" });
    }
    return nuevas;
  }
  const otras = nuevas.reduce((a, f, j) => (j === i + 1 ? a : a + valor(f)), 0);
  nuevas[i + 1] = { ...nuevas[i + 1]!, monto: deCentavos(Math.max(0, totalC - otras)) };
  return nuevas;
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
