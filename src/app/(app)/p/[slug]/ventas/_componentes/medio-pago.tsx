import type { MedioPago } from "@prisma/client";
import { ArrowLeftRight, Banknote, Bitcoin, type LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ETIQUETA_MEDIO_PAGO } from "@/lib/ventas-ui";

export const ICONO_MEDIO_PAGO: Record<MedioPago, LucideIcon> = {
  EFECTIVO: Banknote,
  TRANSFERENCIA: ArrowLeftRight,
  BINANCE: Bitcoin,
};

/** Medio de pago como badge neutral con su ícono (sin colores por medio). */
export function MedioPagoBadge({ medio }: { medio: MedioPago }) {
  const Icono = ICONO_MEDIO_PAGO[medio];
  return (
    <Badge>
      <Icono strokeWidth={1.75} aria-hidden />
      {ETIQUETA_MEDIO_PAGO[medio]}
    </Badge>
  );
}
