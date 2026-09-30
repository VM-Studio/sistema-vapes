import "server-only";

import { EstadoVenta, TipoVenta } from "@prisma/client";

import { ESTADO_STOCK_UI, TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { esOwner } from "@/lib/permisos";
import { formatearFecha, formatearFechaHora } from "@/lib/utils";
import {
  ESTADO_VENTA_UI,
  ETIQUETA_MEDIO_PAGO,
  etiquetaMedioPrincipal,
  ETIQUETA_TIPO_VENTA,
  saborVisible,
  telefonoVisible,
} from "@/lib/ventas-ui";
import type { CtxPanel } from "@/server/auth/permissions";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { reporte, type ClaveReporte } from "@/server/reportes/catalogo";
import type { Celda, Exportacion, TablaExport } from "@/server/reportes/exportar";
import {
  filtrosComprasSchema,
  filtrosDevolucionesSchema,
  filtrosMovimientosSchema,
  filtrosStockSchema,
  filtrosVentasSchema,
  rangoReporte,
} from "@/server/reportes/filtros";
import {
  comprasDelPeriodo,
  describirPeriodo,
  etiquetaRango,
  kpis,
  periodoDesdeParams,
  rendimientoVendedores,
  topProductos,
  topSabores,
  ventasPorDeposito,
  ventasPorMedioPago,
  ventasPorTipo,
  type Comparado,
  type Periodo,
} from "@/server/services/analitica.service";
import {
  compararProveedores,
  historialPrecios,
  matrizProveedores,
  productosConVariosProveedores,
} from "@/server/services/proveedor.service";
import {
  comprasPorProveedor,
  opcionesFiltros,
  reporteClientes,
  reporteDevoluciones,
  reporteMovimientos,
  reporteStock,
  reporteVentas,
  usuariosConMovimientos,
} from "@/server/services/reporte.service";

/**
 * Arma la exportación (PDF/Excel) de cada reporte con los MISMOS parámetros
 * de la URL de la página. Los reportes de dueños se cortan acá (403).
 */

type Params = Record<string, string>;

export function exigirAccesoReporte(ctx: CtxPanel, clave: string): ClaveReporte {
  const r = reporte(clave);
  if (!r) throw new NotFoundError("Ese reporte no existe.");
  if (r.owner && !esOwner(ctx.usuario))
    throw new ForbiddenError(`«${r.titulo}» es solo para dueños.`);
  return r.clave;
}

export function periodoAnalitica(params: Params): { periodo: Periodo; etiqueta: string } {
  const periodo = periodoDesdeParams(params);
  return {
    periodo,
    etiqueta: `${describirPeriodo(periodo).etiqueta} (${etiquetaRango(periodo)})`,
  };
}

const conMoneda = (precio: string, moneda: "ARS" | "USD") =>
  moneda === "USD" ? `US$ ${Number(precio).toLocaleString("es-AR")}` : precio;

const filaComparado = (nombre: string, c: Comparado<string> | Comparado<number>): Celda[] => [
  nombre,
  typeof c.actual === "number" ? c.actual : c.actual,
  typeof c.anterior === "number" ? c.anterior : c.anterior,
  c.deltaPct,
];

export async function armarExportacion(
  ctx: CtxPanel,
  clave: ClaveReporte,
  params: Params,
): Promise<Exportacion> {
  const slug = ctx.panel.slug;
  const owner = esOwner(ctx.usuario);
  const archivo = (s: string) => `reporte-${s}-${slug}`;
  const nombrePor = async () => {
    const o = await opcionesFiltros(ctx);
    const mapa = new Map<string, string>([
      ...o.depositos.map((d) => [d.id, d.nombre] as const),
      ...o.vendedores.map((d) => [d.id, d.nombre] as const),
      ...o.proveedores.map((d) => [d.id, `${d.nombre} (${d.nombreTienda})`] as const),
      ...o.marcas.map((d) => [d.id, d.nombre] as const),
    ]);
    return (id: string | undefined) => (id ? (mapa.get(id) ?? id) : undefined);
  };

  switch (clave) {
    case "comparador": {
      const nombre = await nombrePor();
      if (params.productoId) {
        const c = await compararProveedores(ctx, params.productoId);
        return {
          titulo: `Comparador: ${c.producto.nombreCompleto}`,
          archivo: archivo("comparador"),
          periodo: null,
          filtros: [
            c.cotizacionUsd
              ? `Cotización USD: $ ${c.cotizacionUsd.toLocaleString("es-AR")}`
              : "Sin cotización USD",
          ],
          tablas: [
            {
              columnas: [
                { titulo: "#", tipo: "numero", ancho: 0.4 },
                { titulo: "Proveedor", ancho: 2 },
                { titulo: "Tienda", ancho: 2 },
                { titulo: "Precio", tipo: "moneda", ancho: 1.2 },
                { titulo: "Equiv. $", tipo: "moneda", ancho: 1.2 },
                { titulo: "Diferencia", tipo: "moneda", ancho: 1.1 },
                { titulo: "Dif. %", tipo: "pct", ancho: 0.8 },
                { titulo: "Actualizado", ancho: 1.1 },
                { titulo: "Última compra", ancho: 1.8 },
              ],
              filas: c.ofertas.map((o) => [
                o.posicion,
                `${o.proveedor}${o.masBarato ? " (más barato)" : ""}`,
                o.tienda,
                conMoneda(o.precio, o.moneda),
                o.precioArsEquivalente,
                o.grupo === "USD" ? `US$ ${o.diferencia}` : o.diferencia,
                o.diferenciaPct,
                `${formatearFecha(o.actualizadoAt)}${o.desactualizado ? " (viejo)" : ""}`,
                o.ultimaCompra
                  ? `${formatearFecha(o.ultimaCompra.fecha)} a ${Number(o.ultimaCompra.costo).toLocaleString("es-AR")}`
                  : "—",
              ]),
            },
          ],
        };
      }
      const [varios, matriz] = await Promise.all([
        productosConVariosProveedores(ctx),
        matrizProveedores(ctx, { marcaId: params.marcaId || undefined }),
      ]);
      return {
        titulo: "Comparador de proveedores",
        archivo: archivo("comparador"),
        periodo: null,
        apaisado: true,
        filtros: [
          ...(params.marcaId ? [`Marca: ${nombre(params.marcaId)}`] : []),
          matriz.cotizacionUsd
            ? `Cotización USD: $ ${matriz.cotizacionUsd.toLocaleString("es-AR")}`
            : "Sin cotización USD",
        ],
        tablas: [
          {
            titulo: "Productos con varios proveedores",
            columnas: [
              { titulo: "Producto", ancho: 3 },
              { titulo: "Proveedores", tipo: "numero" },
              { titulo: "Mínimo", tipo: "moneda" },
              { titulo: "Máximo", tipo: "moneda" },
              { titulo: "Ahorro por unidad", tipo: "moneda" },
            ],
            filas: varios.map((v) => [
              `${v.nombreCompleto}${v.moneda === "USD" ? " (US$)" : ""}`,
              v.proveedores,
              v.minimo,
              v.maximo,
              v.ahorro,
            ]),
          },
          {
            titulo: "Matriz de precios",
            columnas: [
              { titulo: "Producto", ancho: 2.5 },
              ...matriz.proveedores.map((p) => ({ titulo: p.nombre, tipo: "moneda" as const })),
            ],
            filas: matriz.filas.map((f) => [
              f.nombreCompleto,
              ...matriz.proveedores.map((p) => {
                const x = f.precios[p.id];
                if (!x) return null;
                return `${x.moneda === "USD" ? `US$ ${x.precio}` : x.precio}${x.masBarato ? " *" : ""}`;
              }),
            ]),
          },
        ],
      };
    }

    case "empresa": {
      const { periodo, etiqueta } = periodoAnalitica(params);
      const [k, medios, tipos, depositos, top, sabores, compras] = await Promise.all([
        kpis(ctx, periodo),
        ventasPorMedioPago(ctx, periodo),
        ventasPorTipo(ctx, periodo),
        ventasPorDeposito(ctx, periodo),
        topProductos(ctx, periodo, 10),
        topSabores(ctx, periodo, 10),
        comprasDelPeriodo(ctx, periodo),
      ]);
      const comp = [
        { titulo: "Indicador", ancho: 2 },
        { titulo: "Actual", tipo: "numero" as const },
        { titulo: "Anterior", tipo: "numero" as const },
        { titulo: "Variación", tipo: "pct" as const },
      ];
      const compPesos = comp.map((c, i) =>
        i === 1 || i === 2 ? { ...c, tipo: "moneda" as const } : c,
      );
      return {
        titulo: "Rendimiento de la empresa",
        archivo: archivo("empresa"),
        periodo: etiqueta,
        filtros: [],
        tablas: [
          {
            titulo: "Montos",
            columnas: compPesos,
            filas: [
              filaComparado("Facturado", k.facturado),
              ...(k.ganancia ? [filaComparado("Ganancia bruta", k.ganancia)] : []),
              filaComparado("Ticket promedio", k.ticketPromedio),
              filaComparado("Compras recibidas", compras.compras),
              filaComparado("Costo de lo vendido", compras.costoVendido),
            ],
          },
          {
            titulo: "Cantidades",
            columnas: comp,
            filas: [
              filaComparado("Ventas", k.cantidadVentas),
              filaComparado("Unidades vendidas", k.unidadesVendidas),
              filaComparado("Clientes nuevos", k.clientesNuevos),
              filaComparado("Devoluciones", k.devoluciones),
              filaComparado("Compras", compras.cantidadCompras),
            ],
          },
          {
            titulo: "Por medio de pago",
            columnas: [
              { titulo: "Medio", ancho: 2 },
              { titulo: "Ventas", tipo: "numero" },
              { titulo: "Total", tipo: "moneda" },
            ],
            filas: medios.map((m) => [m.etiqueta, m.cantidad, m.total]),
          },
          {
            titulo: "Por tipo",
            columnas: [
              { titulo: "Tipo", ancho: 2 },
              { titulo: "Ventas", tipo: "numero" },
              { titulo: "Unidades", tipo: "numero" },
              { titulo: "Total", tipo: "moneda" },
            ],
            filas: tipos.map((t) => [t.etiqueta, t.cantidad, t.unidades, t.total]),
          },
          {
            titulo: "Por galpón",
            columnas: [
              { titulo: "Galpón", ancho: 2 },
              { titulo: "Ventas", tipo: "numero" },
              { titulo: "Total", tipo: "moneda" },
            ],
            filas: depositos.map((d) => [d.nombre, d.cantidad, d.total]),
          },
          {
            titulo: "Productos más vendidos",
            columnas: [
              { titulo: "Producto", ancho: 3 },
              { titulo: "Unidades", tipo: "numero" },
              { titulo: "Facturado", tipo: "moneda" },
              { titulo: "Ganancia", tipo: "moneda" },
            ],
            filas: top.map((t) => [t.nombre, t.unidades, t.facturado, t.ganancia]),
          },
          {
            titulo: "Sabores más vendidos",
            columnas: [
              { titulo: "Sabor", ancho: 3 },
              { titulo: "Unidades", tipo: "numero" },
              { titulo: "Facturado", tipo: "moneda" },
              { titulo: "Ganancia", tipo: "moneda" },
            ],
            filas: sabores.map((t) => [t.nombre, t.unidades, t.facturado, t.ganancia]),
          },
        ],
      };
    }

    case "vendedores": {
      const { periodo, etiqueta } = periodoAnalitica(params);
      const filas = await rendimientoVendedores(ctx, periodo);
      return {
        titulo: "Rendimiento por vendedor",
        archivo: archivo("vendedores"),
        periodo: etiqueta,
        filtros: [],
        apaisado: true,
        tablas: [
          {
            columnas: [
              { titulo: "Vendedor", ancho: 1.8 },
              { titulo: "Ventas", tipo: "numero", ancho: 0.8 },
              { titulo: "Unidades", tipo: "numero", ancho: 0.9 },
              { titulo: "Facturado", tipo: "moneda", ancho: 1.3 },
              { titulo: "Unitarias", tipo: "moneda", ancho: 1.2 },
              { titulo: "Mayoristas", tipo: "moneda", ancho: 1.2 },
              { titulo: "Ticket prom.", tipo: "moneda", ancho: 1.1 },
              { titulo: "Cotiz. conv.", ancho: 1 },
              { titulo: "Clientes nuevos", tipo: "numero", ancho: 1 },
              { titulo: "Devol.", tipo: "numero", ancho: 0.7 },
              { titulo: "Comisión est.", tipo: "moneda", ancho: 1.2 },
            ],
            filas: filas.map((v) => [
              v.nombre,
              v.cantidadVentas,
              v.unidades,
              v.facturado,
              v.unitarias.total,
              v.mayoristas.total,
              v.ticketPromedio,
              `${v.cotizaciones.convertidas}/${v.cotizaciones.creadas}`,
              v.clientesNuevos,
              v.devoluciones,
              v.comision?.estimada ?? null,
            ]),
          },
        ],
      };
    }

    case "ventas": {
      const r = rangoReporte(params);
      const f = filtrosVentasSchema.parse(params);
      const [v, nombre] = await Promise.all([
        reporteVentas(ctx, r, f, { owner, exportar: true }),
        nombrePor(),
      ]);
      const estado = f.estado ?? EstadoVenta.CONFIRMADA;
      return {
        titulo: "Ventas",
        archivo: archivo("ventas"),
        periodo: r.etiqueta,
        apaisado: true,
        filtros: [
          estado === "TODAS"
            ? "Confirmadas y anuladas"
            : `Estado: ${ESTADO_VENTA_UI[estado as EstadoVenta].label}`,
          ...(f.vendedorId ? [`Vendedor: ${nombre(f.vendedorId)}`] : []),
          ...(f.depositoId ? [`Galpón: ${nombre(f.depositoId)}`] : []),
          ...(f.medioPago ? [`Medio de pago: ${ETIQUETA_MEDIO_PAGO[f.medioPago]}`] : []),
          ...(f.tipo ? [`Tipo: ${ETIQUETA_TIPO_VENTA[f.tipo as TipoVenta]}`] : []),
        ],
        tablas: [
          {
            columnas: [
              { titulo: "ID", ancho: 1 },
              { titulo: "Fecha", ancho: 1.1 },
              { titulo: "Cliente", ancho: 1.8 },
              { titulo: "Vendedor", ancho: 1.3 },
              { titulo: "Galpón", ancho: 1.1 },
              { titulo: "Tipo", ancho: 0.9 },
              { titulo: "Medio", ancho: 1 },
              { titulo: "Estado", ancho: 0.9 },
              { titulo: "Unid.", tipo: "numero", ancho: 0.6 },
              { titulo: "Total", tipo: "moneda", ancho: 1.1 },
              ...(owner ? [{ titulo: "Ganancia", tipo: "moneda" as const, ancho: 1.1 }] : []),
            ],
            filas: v.filas.map((x) => [
              x.codigo,
              formatearFechaHora(x.fecha),
              x.cliente,
              x.vendedor,
              x.deposito,
              ETIQUETA_TIPO_VENTA[x.tipo],
              etiquetaMedioPrincipal(x.medioPago),
              ESTADO_VENTA_UI[x.estado].label,
              x.unidades,
              x.total,
              ...(owner ? [x.ganancia] : []),
            ]),
            totales: [
              `${v.resumen.ventas} ventas`,
              "",
              "",
              "",
              "",
              "",
              "",
              "",
              v.resumen.unidades,
              v.resumen.total,
              ...(owner ? [v.resumen.ganancia] : []),
            ],
          },
        ],
      };
    }

    case "stock": {
      const f = filtrosStockSchema.parse(params);
      const [s, nombre] = await Promise.all([reporteStock(ctx, f), nombrePor()]);
      return {
        titulo: "Stock por galpón y sabor",
        archivo: archivo("stock"),
        periodo: `Al ${formatearFechaHora(new Date())}`,
        apaisado: true,
        filtros: [
          ...(f.depositoId ? [`Galpón: ${nombre(f.depositoId)}`] : []),
          ...(f.q ? [`Búsqueda: "${f.q}"`] : []),
          ...(f.estado ? [`Estado: ${ESTADO_STOCK_UI[f.estado].label}`] : []),
        ],
        tablas: [
          {
            columnas: [
              { titulo: "Producto", ancho: 2.6 },
              { titulo: "Sabor", ancho: 1.8 },
              ...s.depositos.map((d) => ({ titulo: d.nombre, tipo: "numero" as const })),
              ...(s.depositos.length > 1 ? [{ titulo: "Total", tipo: "numero" as const }] : []),
              { titulo: "Mínimo", tipo: "numero" as const, ancho: 0.8 },
              { titulo: "Estado", ancho: 1 },
            ],
            filas: s.filas.map((x) => [
              x.producto,
              saborVisible(x.sabor) ?? "—",
              ...s.depositos.map((d) => x.porDeposito[d.id] ?? 0),
              ...(s.depositos.length > 1 ? [x.total] : []),
              x.minimo,
              ESTADO_STOCK_UI[x.estado].label,
            ]),
            totales: [
              `${s.filas.length} sabores`,
              "",
              ...s.depositos.map((d) => s.totales.porDeposito[d.id] ?? 0),
              ...(s.depositos.length > 1 ? [s.totales.total] : []),
              "",
              `${s.totales.sinStock} sin stock · ${s.totales.bajo} bajo`,
            ],
          },
        ],
      };
    }

    case "movimientos": {
      const r = rangoReporte(params);
      const f = filtrosMovimientosSchema.parse(params);
      const [m, nombre, usuarios] = await Promise.all([
        reporteMovimientos(ctx, r, f),
        nombrePor(),
        usuariosConMovimientos(ctx),
      ]);
      return {
        titulo: "Movimientos de stock",
        archivo: archivo("movimientos"),
        periodo: r.etiqueta,
        filtros: [
          ...(f.tipo ? [`Tipo: ${TIPO_MOVIMIENTO_UI[f.tipo].label}`] : []),
          ...(f.depositoId ? [`Galpón: ${nombre(f.depositoId)}`] : []),
          ...(f.usuarioId
            ? [`Usuario: ${usuarios.find((u) => u.id === f.usuarioId)?.nombre ?? f.usuarioId}`]
            : []),
        ],
        tablas: [
          {
            titulo: "Por tipo",
            columnas: [
              { titulo: "Tipo", ancho: 2 },
              { titulo: "Movimientos", tipo: "numero" },
              { titulo: "Unidades", tipo: "numero" },
            ],
            filas: m.porTipo.map((x) => [
              TIPO_MOVIMIENTO_UI[x.tipo].label,
              x.movimientos,
              x.unidades,
            ]),
            totales: ["Total", m.total.movimientos, m.total.unidades],
          },
          {
            titulo: "Por tipo, galpón y usuario",
            columnas: [
              { titulo: "Tipo", ancho: 2 },
              { titulo: "Galpón", ancho: 1.4 },
              { titulo: "Usuario", ancho: 1.4 },
              { titulo: "Movimientos", tipo: "numero" },
              { titulo: "Unidades", tipo: "numero" },
            ],
            filas: m.filas.map((x) => [
              TIPO_MOVIMIENTO_UI[x.tipo].label,
              x.deposito,
              x.usuario,
              x.movimientos,
              x.unidades,
            ]),
          },
        ],
      };
    }

    case "compras": {
      const r = rangoReporte(params);
      const f = filtrosComprasSchema.parse(params);
      const [porProv, historial, nombre] = await Promise.all([
        comprasPorProveedor(ctx, r, f),
        historialPrecios(ctx, {
          proveedorId: f.proveedorId,
          productoId: f.productoId,
          desde: r.inicio,
          hasta: r.fin,
          limite: 2000,
        }),
        nombrePor(),
      ]);
      return {
        titulo: "Compras y precios de proveedores",
        archivo: archivo("compras"),
        periodo: r.etiqueta,
        apaisado: true,
        filtros: [
          ...(f.proveedorId ? [`Proveedor: ${nombre(f.proveedorId)}`] : []),
          ...(f.productoId && historial[0] ? [`Producto: ${historial[0].nombreCompleto}`] : []),
        ],
        tablas: [
          {
            titulo: "Compras recibidas por proveedor",
            columnas: [
              { titulo: "Proveedor", ancho: 2 },
              { titulo: "Tienda", ancho: 2 },
              { titulo: "Compras", tipo: "numero" },
              { titulo: "Unidades", tipo: "numero" },
              { titulo: "Total", tipo: "moneda" },
              { titulo: "Última", ancho: 1 },
            ],
            filas: porProv.map((x) => [
              x.proveedor,
              x.tienda,
              x.compras,
              x.unidades,
              x.total,
              formatearFecha(x.ultima),
            ]),
            totales: [
              "Total",
              "",
              porProv.reduce((a, x) => a + x.compras, 0),
              porProv.reduce((a, x) => a + x.unidades, 0),
              porProv.reduce((a, x) => a + Number(x.total), 0).toFixed(2),
              "",
            ],
          },
          {
            titulo: "Evolución de precios",
            columnas: [
              { titulo: "Fecha", ancho: 1.1 },
              { titulo: "Producto", ancho: 2.4 },
              { titulo: "Proveedor", ancho: 2 },
              { titulo: "Anterior", tipo: "moneda" },
              { titulo: "Nuevo", tipo: "moneda" },
              { titulo: "Variación", tipo: "pct", ancho: 0.8 },
            ],
            filas: historial.map((h) => [
              formatearFechaHora(h.fecha),
              h.nombreCompleto,
              `${h.proveedor} (${h.tienda})`,
              h.anterior === null ? "Alta" : conMoneda(h.anterior, h.monedaAnterior ?? "ARS"),
              conMoneda(h.precio, h.moneda),
              h.variacionPct,
            ]),
          },
        ],
      };
    }

    case "clientes": {
      const r = rangoReporte(params);
      const c = await reporteClientes(ctx, r, { owner });
      const tablas: TablaExport[] = [
        {
          titulo: `Clientes nuevos (${c.nuevos.length})`,
          columnas: [
            { titulo: "Cliente", ancho: 2 },
            { titulo: "Teléfono", ancho: 1.4 },
            { titulo: "Alta", ancho: 1 },
            { titulo: "Compras", tipo: "numero", ancho: 0.8 },
          ],
          filas: c.nuevos.map((x) => [
            x.nombre,
            telefonoVisible(x.telefono),
            formatearFecha(x.alta),
            x.compras,
          ]),
        },
      ];
      if (c.top) {
        tablas.push({
          titulo: "Mejores compradores del período",
          columnas: [
            { titulo: "Cliente", ancho: 2 },
            { titulo: "Teléfono", ancho: 1.4 },
            { titulo: "Compras", tipo: "numero", ancho: 0.8 },
            { titulo: "Unidades", tipo: "numero", ancho: 0.8 },
            { titulo: "Total", tipo: "moneda" },
          ],
          filas: c.top.map((x) => [
            x.nombre,
            telefonoVisible(x.telefono),
            x.compras,
            x.unidades,
            x.total,
          ]),
        });
      }
      tablas.push({
        titulo: `Inactivos hace más de 60 días (${c.inactivos.length})`,
        columnas: [
          { titulo: "Cliente", ancho: 2 },
          { titulo: "Teléfono", ancho: 1.4 },
          { titulo: "Última compra", ancho: 1 },
          { titulo: "Días", tipo: "numero", ancho: 0.7 },
          { titulo: "Compras", tipo: "numero", ancho: 0.8 },
        ],
        filas: c.inactivos.map((x) => [
          x.nombre,
          telefonoVisible(x.telefono),
          formatearFecha(x.ultimaCompra),
          x.dias,
          x.compras,
        ]),
      });
      return {
        titulo: "Clientes",
        archivo: archivo("clientes"),
        periodo: r.etiqueta,
        filtros: [],
        tablas,
      };
    }

    case "devoluciones": {
      const r = rangoReporte(params);
      const f = filtrosDevolucionesSchema.parse(params);
      const [d, nombre] = await Promise.all([reporteDevoluciones(ctx, r, f), nombrePor()]);
      return {
        titulo: "Devoluciones por garantía",
        archivo: archivo("devoluciones"),
        periodo: r.etiqueta,
        filtros: f.depositoId ? [`Galpón: ${nombre(f.depositoId)}`] : [],
        tablas: [
          {
            columnas: [
              { titulo: "Producto", ancho: 2.5 },
              { titulo: "Sabor", ancho: 1.6 },
              { titulo: "Devoluciones", tipo: "numero" },
              { titulo: "Unidades", tipo: "numero" },
            ],
            filas: d.filas.map((x) => [
              x.producto,
              saborVisible(x.sabor) ?? "—",
              x.devoluciones,
              x.unidades,
            ]),
            totales: ["Total", "", d.total.devoluciones, d.total.unidades],
          },
        ],
      };
    }

    case "resumen-mensual":
      throw new NotFoundError("El resumen mensual se exporta solo en PDF.");
  }
}
