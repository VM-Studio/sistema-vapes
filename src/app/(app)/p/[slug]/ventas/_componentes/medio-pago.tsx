import type { EstadoPago, MedioPago } from "@prisma/client";
import { ArrowLeftRight, Banknote, Bitcoin, HandCoins, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatearPesos } from "@/lib/format";
import { ESTADO_PAGO_UI, ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

export const ICONO_MEDIO_PAGO: Record<MedioPago, LucideIcon> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowLeftRight,
  BINANCE: Bitcoin,
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
