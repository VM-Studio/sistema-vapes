import { Badge } from "@/components/ui/badge";
import { ESTADO_STOCK_UI } from "@/lib/movimientos-ui";
import { cn } from "@/lib/utils";

/**
 * Estado del stock de un sabor/producto: OK neutral (gris), Bajo mínimo en
 * alerta y Sin stock en error. Sobre una tarjeta gris, `sobreGris` le da
 * contraste al OK.
 */
export function EstadoStockBadge({
  estado,
  sobreGris = false,
  className,
}: {
  estado: keyof typeof ESTADO_STOCK_UI;
  sobreGris?: boolean;
  className?: string;
}) {
  const e = ESTADO_STOCK_UI[estado];
  const variante = estado === "OK" ? "neutral" : e.variante;
  return (
    <Badge
      variant={variante}
      className={cn(estado === "OK" && sobreGris && "bg-surface-3 text-foreground", className)}
    >
      {e.label}
    </Badge>
  );
}
