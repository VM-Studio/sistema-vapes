import type { EstadoPago, MedioPago } from "@prisma/client";
import {
  ArrowLeftRight,
  Banknote,
  Bitcoin,
  HandCoins,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatearPesos } from "@/lib/format";
import { formatearFechaHora } from "@/lib/utils";
import { ESTADO_PAGO_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

export const ICONO_MEDIO_PAGO: Record<MedioPago, LucideIcon> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowLeftRight,
  BINANCE: Bitcoin,
  /** Ícono genérico de compra online (sin logo de la marca). */
  MERCADO_LIBRE: ShoppingBag,
};

/**
 * Medio de pago (principal) como badge neutral con su ícono (sin colores por
 * medio). null = la venta se fió entera.
 */
export function MedioPagoBadge({ medio }: { medio: MedioPago | null }) {
  const Icono = medio ? ICONO_MEDIO_PAGO[medio] : HandCoins;
  return (
    <Badge>
      <Icono strokeWidth={1.75} aria-hidden />
      {medio ? ETIQUETA_MEDIO_PAGO[medio] : "Fiado"}
    </Badge>
  );
}

/** "Debe $ X" en ámbar apagado si la venta tiene saldo pendiente; nada si está pagada. */
export function EstadoPagoBadge({ estado, saldo }: { estado: EstadoPago; saldo: string }) {
  if (estado === "PAGADA" || !(Number(saldo) > 0)) return null;
  return (
    <Badge variant={ESTADO_PAGO_UI[estado].variante} title={ESTADO_PAGO_UI[estado].label}>
      Debe {formatearPesos(saldo)}
    </Badge>
  );
}

/**
 * Estado de pago en palabras: «Pagada con Transferencia el 25/10/2026 14:30»
 * (medios de los pagos vigentes, fecha del último) o «Pendiente de pago».
 */
export function textoEstadoPago(
  estado: EstadoPago,
  pagos: { medioPago: MedioPago; fecha: Date; anulado?: boolean }[],
): string {
  if (estado === "PENDIENTE") return "Pendiente de pago";
  if (estado === "PARCIAL") return "Pago parcial · resto pendiente de pago";
  const vigentes = pagos.filter((p) => !p.anulado);
  if (vigentes.length === 0) return "Pagada";
  const medios = [...new Set(vigentes.map((p) => ETIQUETA_MEDIO_PAGO[p.medioPago]))];
  const ultimo = vigentes.reduce((a, p) => (p.fecha > a.fecha ? p : a));
  return `Pagada con ${medios.join(" + ")} el ${formatearFechaHora(ultimo.fecha)}`;
}
