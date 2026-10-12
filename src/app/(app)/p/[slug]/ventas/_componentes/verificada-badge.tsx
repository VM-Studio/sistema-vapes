import { ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";

/** Venta con todas sus unidades escaneadas contra el carrito ("Verificar con pistola"). */
export function VerificadaBadge() {
  return (
    <Badge variant="success" title="Todas las unidades se verificaron con la pistola">
      <ScanLine strokeWidth={2} aria-hidden /> Verificada
    </Badge>
  );
}
