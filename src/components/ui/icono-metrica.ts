import {
  AlertTriangle,
  BarChart3,
  Boxes,
  CalendarClock,
  Clock3,
  CreditCard,
  DatabaseBackup,
  HandCoins,
  Package,
  ShoppingCart,
  Tag,
  TrendingUp,
  Truck,
  Undo2,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/** Tonos de la paleta del logo para íconos de métricas (círculo suave + ícono). */
export type TonoMetrica = "azul" | "cielo" | "oliva" | "naranja" | "marron";

export const CLASE_TONO: Record<TonoMetrica, string> = {
  azul: "bg-tono-azul-suave text-tono-azul",
  cielo: "bg-tono-cielo-suave text-tono-cielo",
  oliva: "bg-tono-oliva-suave text-tono-oliva",
  naranja: "bg-tono-naranja-suave text-tono-naranja",
  marron: "bg-tono-marron-suave text-tono-marron",
};

/**
 * Ícono y tono de una métrica según su etiqueta, para que todas las tarjetas
 * del sistema (StatCard, KpiCard) hablen el mismo idioma visual sin tener que
 * elegirlo en cada pantalla: plata facturada en azul, lo cobrado en oliva,
 * deudas en naranja, ganancia en marrón, clientes en celeste, stock y unidades en marrón.
 * El orden importa: la primera regla que coincide gana.
 */
const REGLAS: { patron: RegExp; icono: LucideIcon; tono: TonoMetrica }[] = [
  { patron: /bajo m[ií]nimo|sin stock/i, icono: AlertTriangle, tono: "naranja" },
  { patron: /ganancia|margen|comisi/i, icono: TrendingUp, tono: "marron" },
  { patron: /deudores/i, icono: Users, tono: "naranja" },
  { patron: /por cobrar|debe|deud|fiad/i, icono: Clock3, tono: "naranja" },
  { patron: /cobrad/i, icono: Wallet, tono: "oliva" },
  { patron: /ticket/i, icono: CreditCard, tono: "oliva" },
  { patron: /clientes? nuevos?/i, icono: UserPlus, tono: "cielo" },
  { patron: /cliente|inactivo/i, icono: Users, tono: "cielo" },
  { patron: /devoluc|devuelt/i, icono: Undo2, tono: "naranja" },
  { patron: /compra/i, icono: Truck, tono: "marron" },
  { patron: /backup|frecuencia|conserva/i, icono: DatabaseBackup, tono: "marron" },
  { patron: /[uú]ltim|m[aá]s viejo|pendiente/i, icono: CalendarClock, tono: "marron" },
  { patron: /vendidos/i, icono: ShoppingCart, tono: "azul" },
  { patron: /factur|total|vendido|cobr/i, icono: BarChart3, tono: "azul" },
  { patron: /^ventas?$/i, icono: Tag, tono: "naranja" },
  { patron: /vend|venta/i, icono: ShoppingCart, tono: "azul" },
  { patron: /unidad|stock/i, icono: Boxes, tono: "marron" },
  { patron: /cobro|pago/i, icono: HandCoins, tono: "oliva" },
];

export function iconoMetrica(label: string): { icono: LucideIcon; tono: TonoMetrica } {
  return REGLAS.find((r) => r.patron.test(label)) ?? { icono: Package, tono: "azul" };
}
