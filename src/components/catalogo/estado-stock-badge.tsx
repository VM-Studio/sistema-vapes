import { Badge } from "@/components/ui/badge";
import { ESTADO_STOCK_UI } from "@/lib/movimientos-ui";

export function EstadoStockBadge({ estado }: { estado: keyof typeof ESTADO_STOCK_UI }) {
  const e = ESTADO_STOCK_UI[estado];
  return <Badge variant={e.variante}>{e.label}</Badge>;
}
