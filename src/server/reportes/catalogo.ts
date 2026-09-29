/**
 * Catálogo de reportes (puro): clave de URL, textos del índice y si son SOLO
 * para dueños (costos, precios de proveedor, ganancias, rendimiento de otros).
 * La página, la exportación y el índice leen de acá.
 */
export const REPORTES = [
  {
    clave: "comparador",
    titulo: "Comparador de proveedores",
    descripcion:
      "Quién te vende más barato cada producto, con la última compra y el ahorro por unidad.",
    owner: true,
  },
  {
    clave: "empresa",
    titulo: "Rendimiento de la empresa",
    descripcion: "Facturación, ganancia, ticket promedio y comparación con el período anterior.",
    owner: true,
  },
  {
    clave: "vendedores",
    titulo: "Rendimiento por vendedor",
    descripcion: "Ventas, unidades, cotizaciones convertidas y comisión estimada de cada uno.",
    owner: true,
  },
  {
    clave: "ventas",
    titulo: "Ventas",
    descripcion: "El detalle de las ventas con filtros por vendedor, galpón, medio de pago y tipo.",
    owner: false,
  },
  {
    clave: "stock",
    titulo: "Stock por galpón y sabor",
    descripcion: "Matriz producto × sabor × galpón con total, mínimo y estado.",
    owner: false,
  },
  {
    clave: "movimientos",
    titulo: "Movimientos de stock",
    descripcion: "Entradas y salidas por tipo, galpón y usuario.",
    owner: false,
  },
  {
    clave: "compras",
    titulo: "Compras y precios de proveedores",
    descripcion: "Compras por proveedor y la evolución del precio de cada producto.",
    owner: true,
  },
  {
    clave: "clientes",
    titulo: "Clientes",
    descripcion: "Nuevos por período, mejores compradores e inactivos hace más de 60 días.",
    owner: false,
  },
  {
    clave: "devoluciones",
    titulo: "Devoluciones por garantía",
    descripcion: "Unidades devueltas por producto y sabor en el período.",
    owner: false,
  },
  {
    clave: "resumen-mensual",
    titulo: "Resumen mensual",
    descripcion: "Una página con los números del mes: KPIs, top 5, compras vs. ventas y equipo.",
    owner: true,
  },
] as const;

export type ClaveReporte = (typeof REPORTES)[number]["clave"];

export function reporte(clave: string) {
  return REPORTES.find((r) => r.clave === clave) ?? null;
}
