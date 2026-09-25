import "server-only";

import { Modulo, type MedioPago } from "@prisma/client";

import { prisma } from "@/lib/db";
import { puede, type SujetoPermisos } from "@/lib/permisos";
import type {
  ColumnaReporte,
  DocumentoReporte,
  FilaReporte,
  GraficoReporte,
  KpiReporte,
} from "@/lib/reportes/documento";
import { etiquetaRango, type ParametrosReporte } from "@/lib/reportes/parametros";
import { TIPO_MOVIMIENTO_UI } from "@/lib/movimientos-ui";
import { limitesRango, type Periodo } from "@/lib/zona-horaria";
import { listarCajas } from "@/server/services/caja.service";
import { ETIQUETA_MEDIO_PAGO } from "@/server/services/comprobante.service";
import { obtenerZonaHoraria } from "@/server/services/configuracion.service";
import { gastosPorCategoria, gastosPorMes, listarGastos } from "@/server/services/gasto.service";
import { obtenerMatrizStockCompleta } from "@/server/services/inventario.service";
import { nombreCompleto } from "@/server/services/producto.service";
import * as R from "@/server/services/reporte.service";

/**
 * Catálogo de reportes. Cada uno declara qué permisos pide y qué filtros usa,
 * y arma un DocumentoReporte (lo mismo se ve en pantalla y se exporta).
 *
 * Permisos: REPORTES "ver" para todos; `finanzas` además exige FINANZAS "ver";
 * `modulo` suma el permiso de ese módulo (gastos, clientes). Sin FINANZAS, los
 * reportes permitidos se arman SIN columnas de costo ni ganancia.
 */

export type FiltroUi = "periodo" | "deposito" | "categoria" | "vendedor" | "diferencia";

export interface ContextoReporte {
  finanzas: boolean;
  tz: string;
}

export interface DefinicionReporte {
  slug: string;
  numero: number;
  titulo: string;
  descripcion: string;
  finanzas: boolean;
  modulo?: Modulo;
  filtros: FiltroUi[];
  periodoPorDefecto: Periodo;
  orientacion: "vertical" | "apaisado";
  construir: (p: ParametrosReporte, ctx: ContextoReporte) => Promise<DocumentoReporte>;
}

export function puedeVerReporte(
  u: SujetoPermisos,
  d: Pick<DefinicionReporte, "finanzas" | "modulo">,
) {
  return (
    puede(u, Modulo.REPORTES, "ver") &&
    (!d.finanzas || puede(u, Modulo.FINANZAS, "ver")) &&
    (!d.modulo || puede(u, d.modulo, "ver"))
  );
}

// -----------------------------------------------------------------------------
// Ayudas
// -----------------------------------------------------------------------------

const col = (
  clave: string,
  titulo: string,
  tipo: ColumnaReporte["tipo"],
  extra: Partial<ColumnaReporte> = {},
): ColumnaReporte => ({
  clave,
  titulo,
  tipo,
  ...extra,
});

async function filtrosDe(p: ParametrosReporte, usa: FiltroUi[]) {
  const [dep, cat, vend] = await Promise.all([
    p.depositoId && usa.includes("deposito")
      ? prisma.deposito.findUnique({ where: { id: p.depositoId }, select: { nombre: true } })
      : null,
    p.categoriaId && usa.includes("categoria")
      ? prisma.categoria.findUnique({ where: { id: p.categoriaId }, select: { nombre: true } })
      : null,
    p.usuarioId && usa.includes("vendedor")
      ? prisma.usuario.findUnique({ where: { id: p.usuarioId }, select: { nombre: true } })
      : null,
  ]);
  const f: { etiqueta: string; valor: string }[] = [];
  if (usa.includes("periodo")) f.push({ etiqueta: "Período", valor: etiquetaRango(p) });
  if (usa.includes("deposito")) f.push({ etiqueta: "Depósito", valor: dep?.nombre ?? "Todos" });
  if (usa.includes("categoria")) f.push({ etiqueta: "Categoría", valor: cat?.nombre ?? "Todas" });
  if (usa.includes("vendedor")) f.push({ etiqueta: "Vendedor", valor: vend?.nombre ?? "Todos" });
  if (usa.includes("diferencia") && p.soloConDiferencia)
    f.push({ etiqueta: "Cajas", valor: "Solo con diferencia" });
  return f;
}

const filtroReporte = (p: ParametrosReporte, usa: FiltroUi[]): R.FiltroReporte => ({
  ...p.rango,
  depositoId: usa.includes("deposito") ? p.depositoId : undefined,
  categoriaId: usa.includes("categoria") ? p.categoriaId : undefined,
  usuarioId: usa.includes("vendedor") ? p.usuarioId : undefined,
});

const etiquetaPeriodo = (iso: string, gran: R.Granularidad) =>
  gran === "mes"
    ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}`
    : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function kpisDeVentas(k: R.Kpis, finanzas: boolean): KpiReporte[] {
  return [
    { etiqueta: "Ventas", valor: k.ventas.actual, tipo: "moneda", delta: k.ventas.delta },
    {
      etiqueta: "Cantidad de ventas",
      valor: Number(k.cantidadVentas.actual),
      tipo: "entero",
      delta: k.cantidadVentas.delta,
    },
    {
      etiqueta: "Unidades",
      valor: Number(k.unidades.actual),
      tipo: "entero",
      delta: k.unidades.delta,
    },
    {
      etiqueta: "Ticket promedio",
      valor: k.ticketPromedio.actual,
      tipo: "moneda",
      delta: k.ticketPromedio.delta,
    },
    ...(finanzas
      ? ([
          {
            etiqueta: "Ganancia bruta",
            valor: k.gananciaBruta.actual,
            tipo: "moneda",
            delta: k.gananciaBruta.delta,
          },
          {
            etiqueta: "Margen bruto",
            valor: k.margen.actual,
            tipo: "porcentaje",
            delta: k.margen.delta,
          },
        ] satisfies KpiReporte[])
      : []),
  ];
}

// -----------------------------------------------------------------------------
// 1. Ventas
// -----------------------------------------------------------------------------

const ventas: DefinicionReporte = {
  slug: "ventas",
  numero: 1,
  titulo: "Ventas",
  descripcion: "Resumen y detalle: por día, medio de pago, vendedor, depósito y hora.",
  finanzas: false,
  filtros: ["periodo", "deposito", "vendedor"],
  periodoPorDefecto: "mes",
  orientacion: "apaisado",
  async construir(p, ctx) {
    const usa = this.filtros;
    const f = filtroReporte(p, usa);
    const gran = R.granularidadPara(f);
    const [k, serie, medios, vendedores, depositos, horas, dias] = await Promise.all([
      R.kpis(f),
      R.serieTemporal({ ...f, granularidad: gran }),
      R.ventasPorMedioPago(f),
      R.ventasPorVendedor(f),
      R.ventasPorDeposito(f),
      R.ventasPorHoraDelDia(f),
      R.ventasPorDiaSemana(f),
    ]);
    const { inicio, fin } = limitesRango(f.desde, f.hasta, ctx.tz);
    const detalle = await prisma.venta.findMany({
      where: {
        estado: { in: ["CONFIRMADA", "ANULADA"] },
        fecha: { gte: inicio, lt: fin },
        ...(f.depositoId ? { depositoId: f.depositoId } : {}),
        ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}),
      },
      orderBy: { fecha: "asc" },
      take: 5000,
      select: {
        id: true,
        numero: true,
        fecha: true,
        estado: true,
        total: true,
        gananciaBruta: true,
        saldoPendiente: true,
        medioPago: true,
        cliente: { select: { nombre: true, apellido: true } },
        usuario: { select: { nombre: true } },
        deposito: { select: { nombre: true } },
      },
    });
    const vendedoresFiltrados = f.usuarioId
      ? vendedores.filter((v) => v.usuarioId === f.usuarioId)
      : vendedores;
    const fin$ = ctx.finanzas;
    return {
      titulo: "Reporte de ventas",
      filtros: await filtrosDe(p, usa),
      orientacion: "apaisado",
      kpis: kpisDeVentas(k, fin$),
      graficos: [
        {
          id: "serie",
          tipo: "area",
          titulo: `Ventas por ${gran === "dia" ? "día" : gran}${fin$ ? " y ganancia bruta" : ""}`,
          x: "periodo",
          formato: "moneda",
          series: [
            { clave: "ventas", nombre: "Ventas" },
            ...(fin$ ? [{ clave: "ganancia", nombre: "Ganancia bruta" }] : []),
          ],
          datos: serie.map((s) => ({
            periodo: etiquetaPeriodo(s.periodo, gran),
            ventas: Number(s.ventas),
            ...(fin$ ? { ganancia: Number(s.gananciaBruta) } : {}),
          })),
          enPdf: true,
        },
        {
          id: "medios",
          tipo: "donut",
          titulo: "Cobrado por medio de pago",
          x: "medio",
          formato: "moneda",
          series: [{ clave: "total", nombre: "Cobrado" }],
          datos: medios.medios.map((m) => ({
            medio: ETIQUETA_MEDIO_PAGO[m.medioPago],
            total: Number(m.total),
          })),
        },
        {
          id: "horas",
          tipo: "barras",
          titulo: "Ventas por hora del día",
          x: "hora",
          formato: "entero",
          series: [{ clave: "cantidad", nombre: "Ventas" }],
          datos: horas
            .filter((h) => h.hora >= 8)
            .map((h) => ({ hora: `${h.hora} h`, cantidad: h.cantidad })),
        },
      ],
      secciones: [
        {
          id: "por-dia",
          titulo: `Por ${gran === "dia" ? "día" : gran === "semana" ? "semana" : "mes"}`,
          columnas: [
            col("periodo", gran === "dia" ? "Día" : "Desde", "fecha"),
            col("cantidad", "Ventas", "entero"),
            col("ventas", "Total", "moneda"),
            ...(fin$
              ? [col("costo", "Costo", "moneda"), col("ganancia", "Ganancia bruta", "moneda")]
              : []),
          ],
          filas: serie.map((s) => ({
            periodo: s.periodo,
            cantidad: s.cantidad,
            ventas: s.ventas,
            costo: s.costo,
            ganancia: s.gananciaBruta,
          })),
          totales: {
            periodo: "Total",
            cantidad: Number(k.cantidadVentas.actual),
            ventas: k.ventas.actual,
            costo: String(Number(k.ventas.actual) - Number(k.gananciaBruta.actual)),
            ganancia: k.gananciaBruta.actual,
          },
        },
        {
          id: "medios",
          titulo: "Por medio de pago (cobrado en el período)",
          descripcion: `Incluye cobros de cuenta corriente. Efectivo cobrado sin caja abierta: $ ${Number(medios.efectivoFueraDeCaja).toLocaleString("es-AR")}.`,
          columnas: [
            col("medio", "Medio", "texto"),
            col("total", "Total", "moneda"),
            col("porcentaje", "%", "porcentaje"),
          ],
          filas: medios.medios.map((m) => ({
            medio: ETIQUETA_MEDIO_PAGO[m.medioPago],
            total: m.total,
            porcentaje: m.porcentaje,
          })),
          totales: { medio: "Total", total: medios.total, porcentaje: 100 },
        },
        {
          id: "vendedores",
          titulo: "Por vendedor",
          columnas: [
            col("nombre", "Vendedor", "texto"),
            col("cantidad", "Ventas", "entero"),
            col("total", "Total", "moneda"),
            col("ticket", "Ticket promedio", "moneda"),
            ...(fin$ ? [col("ganancia", "Ganancia bruta", "moneda")] : []),
          ],
          filas: vendedoresFiltrados.map((v) => ({
            nombre: v.nombre,
            cantidad: v.cantidad,
            total: v.total,
            ticket: v.ticketPromedio,
            ganancia: v.gananciaBruta,
          })),
        },
        {
          id: "depositos",
          titulo: "Por depósito",
          columnas: [
            col("deposito", "Depósito", "texto"),
            col("cantidad", "Ventas", "entero"),
            col("unidades", "Unidades", "entero"),
            col("ventas", "Total", "moneda"),
            col("porcentaje", "%", "porcentaje"),
            ...(fin$ ? [col("ganancia", "Ganancia bruta", "moneda")] : []),
          ],
          filas: (f.usuarioId ? [] : depositos).map((d) => ({
            deposito: d.deposito,
            cantidad: d.cantidad,
            unidades: d.unidades,
            ventas: d.ventas,
            porcentaje: d.porcentaje,
            ganancia: d.gananciaBruta,
          })),
          vacio: f.usuarioId ? "Con un vendedor elegido, ver el detalle." : undefined,
        },
        {
          id: "horas",
          titulo: "Por hora del día",
          columnas: [
            col("hora", "Hora", "texto"),
            col("cantidad", "Ventas", "entero"),
            col("total", "Total", "moneda"),
          ],
          filas: horas
            .filter((h) => h.cantidad > 0)
            .map((h) => ({
              hora: `${String(h.hora).padStart(2, "0")}:00`,
              cantidad: h.cantidad,
              total: h.total,
            })),
        },
        {
          id: "dias-semana",
          titulo: "Por día de la semana",
          columnas: [
            col("dia", "Día", "texto"),
            col("cantidad", "Ventas", "entero"),
            col("total", "Total", "moneda"),
            col("promedio", "Promedio por día", "moneda"),
          ],
          filas: dias.map((d) => ({ ...d })),
        },
        {
          id: "detalle",
          titulo: "Detalle de ventas",
          columnas: [
            col("numero", "N.º", "entero", { ancho: 0.7, enlace: "href" }),
            col("fecha", "Fecha", "fechaHora"),
            col("cliente", "Cliente", "texto"),
            col("vendedor", "Vendedor", "texto", { ancho: 1.6 }),
            col("deposito", "Depósito", "texto", { ancho: 1.4 }),
            col("medio", "Medio", "texto", { ancho: 1.6 }),
            col("estado", "Estado", "texto", { ancho: 1.2 }),
            col("total", "Total", "moneda"),
            col("saldo", "Saldo", "moneda"),
            ...(fin$ ? [col("ganancia", "Ganancia", "moneda")] : []),
          ],
          filas: detalle.map((v) => ({
            numero: v.numero,
            href: `/ventas/${v.id}`,
            fecha: v.fecha.toISOString(),
            cliente: v.cliente
              ? [v.cliente.nombre, v.cliente.apellido].filter(Boolean).join(" ")
              : null,
            vendedor: v.usuario.nombre,
            deposito: v.deposito.nombre,
            medio: v.medioPago ? ETIQUETA_MEDIO_PAGO[v.medioPago] : "Cuenta corriente",
            estado: v.estado === "ANULADA" ? "Anulada" : "Confirmada",
            total: v.total.toFixed(2),
            saldo: v.saldoPendiente.toFixed(2),
            ganancia: v.estado === "ANULADA" ? null : v.gananciaBruta.toFixed(2),
            ...(v.estado === "ANULADA" ? { _alerta: "warning" as const } : {}),
          })),
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 2. Ganancias por producto y sabor (FINANZAS)
// -----------------------------------------------------------------------------

const ganancias: DefinicionReporte = {
  slug: "ganancias",
  numero: 2,
  titulo: "Ganancias por producto y sabor",
  descripcion: "Ganancia real (precio efectivo − costo congelado, neto de devoluciones) y margen.",
  finanzas: true,
  filtros: ["periodo", "deposito", "categoria"],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p) {
    const usa = this.filtros;
    const g = await R.gananciaPorProducto(filtroReporte(p, usa));
    const cols = (primera: ColumnaReporte): ColumnaReporte[] => [
      primera,
      col("unidades", "Unidades", "entero"),
      col("facturacion", "Facturación", "moneda"),
      col("costo", "Costo", "moneda"),
      col("ganancia", "Ganancia", "moneda"),
      col("margen", "Margen", "porcentaje"),
    ];
    const tot: FilaReporte = {
      unidades: g.total.unidades,
      facturacion: g.total.facturacion,
      costo: g.total.costo,
      ganancia: g.total.ganancia,
      margen: g.total.margen,
    };
    return {
      titulo: "Ganancias por producto y sabor",
      filtros: await filtrosDe(p, usa),
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Facturación neta", valor: g.total.facturacion, tipo: "moneda" },
        { etiqueta: "Costo", valor: g.total.costo, tipo: "moneda" },
        { etiqueta: "Ganancia bruta", valor: g.total.ganancia, tipo: "moneda" },
        { etiqueta: "Margen", valor: g.total.margen, tipo: "porcentaje" },
      ],
      graficos: [
        {
          id: "top",
          tipo: "barrasH",
          titulo: "Productos con más ganancia",
          x: "nombre",
          formato: "moneda",
          series: [{ clave: "ganancia", nombre: "Ganancia" }],
          datos: g.productos
            .slice(0, 10)
            .map((x) => ({ nombre: x.nombre, ganancia: Number(x.ganancia) })),
        },
      ],
      secciones: [
        {
          id: "productos",
          titulo: "Por producto",
          columnas: cols(col("nombre", "Producto", "texto")),
          filas: g.productos.map((x) => ({ ...x })),
          totales: { nombre: "Total", ...tot },
        },
        {
          id: "sabores",
          titulo: "Por sabor",
          columnas: cols(col("nombre", "Producto — sabor", "texto", { ancho: 4 })),
          filas: g.sabores.map((x) => ({ ...x })),
          totales: { nombre: "Total", ...tot },
        },
      ],
      nota: "Facturación neta: precio de venta con el descuento global y el redondeo prorrateados, menos lo devuelto. Costo: el congelado al vender.",
    };
  },
};

// -----------------------------------------------------------------------------
// 3. Stock por galpón y sabor (el reporte estrella: A4 apaisado)
// -----------------------------------------------------------------------------

const ESTADO_STOCK: Record<string, string> = {
  OK: "OK",
  BAJO: "Bajo mínimo",
  SIN_STOCK: "Sin stock",
};

const stock: DefinicionReporte = {
  slug: "stock",
  numero: 3,
  titulo: "Stock por galpón y sabor",
  descripcion: "Matriz producto × sabor × depósito con totales, mínimo, estado y días de stock.",
  finanzas: false,
  filtros: ["deposito", "categoria"],
  periodoPorDefecto: "mes",
  orientacion: "apaisado",
  async construir(p, ctx) {
    const usa = this.filtros;
    const [{ depositos, filas }, promedios] = await Promise.all([
      obtenerMatrizStockCompleta(
        { categoriaId: p.categoriaId },
        { incluirValorizacion: ctx.finanzas },
      ),
      R.promediosVenta30(),
    ]);
    const deps = p.depositoId ? depositos.filter((d) => d.id === p.depositoId) : depositos;
    const columnas: ColumnaReporte[] = [
      col("producto", "Producto", "texto", { ancho: 3 }),
      col("sabor", "Sabor", "texto", { ancho: 2.6 }),
      ...deps.map((d) => col(`dep_${d.id}`, d.nombre, "entero", { ancho: 1.1 })),
      ...(deps.length > 1 ? [col("total", "Total", "entero", { ancho: 1 })] : []),
      col("minimo", "Mínimo", "entero", { ancho: 1 }),
      col("estado", "Estado", "texto", { ancho: 1.3 }),
      col("dias", "Días de stock", "decimal", { ancho: 1.1 }),
      ...(ctx.finanzas ? [col("valor", "Valor a costo", "moneda", { ancho: 1.5 })] : []),
    ];
    const salida: FilaReporte[] = [];
    const totalesDep: Record<string, number> = {};
    let totalGeneral = 0;
    let valorGeneral = 0;
    let bajo = 0;
    let sin = 0;
    const porProducto = new Map<string, typeof filas>();
    for (const f of filas)
      porProducto.set(f.productoId, [...(porProducto.get(f.productoId) ?? []), f]);
    for (const [, sabores] of porProducto) {
      const primero = sabores[0]!;
      const sub: FilaReporte = { producto: `Subtotal ${primero.producto}`, _estilo: "subtotal" };
      let subTotal = 0;
      let subValor = 0;
      for (const s of sabores) {
        const total = deps.reduce((a, d) => a + (s.porDeposito[d.id] ?? 0), 0);
        const prom = promedios.get(s.varianteId) ?? 0;
        const fila: FilaReporte = {
          producto: primero.tieneVariantes ? primero.producto : s.producto,
          sabor: s.tieneVariantes ? s.variante : "—",
          total,
          minimo: s.stockMinimo,
          estado: ESTADO_STOCK[s.estado] ?? s.estado,
          dias: R.diasDeStock(s.total, prom),
          valor: s.valorizacion ? (Number(s.valorizacion.precioCosto) * total).toFixed(2) : null,
          ...(s.estado === "SIN_STOCK"
            ? { _alerta: "danger" as const }
            : s.estado === "BAJO"
              ? { _alerta: "warning" as const }
              : {}),
        };
        if (s.estado === "SIN_STOCK") sin++;
        else if (s.estado === "BAJO") bajo++;
        for (const d of deps) {
          const n = s.porDeposito[d.id] ?? 0;
          fila[`dep_${d.id}`] = n;
          sub[`dep_${d.id}`] = Number(sub[`dep_${d.id}`] ?? 0) + n;
          totalesDep[d.id] = (totalesDep[d.id] ?? 0) + n;
        }
        subTotal += total;
        subValor += Number(fila.valor ?? 0);
        salida.push(fila);
      }
      if (sabores.length > 1) {
        sub.total = subTotal;
        if (ctx.finanzas) sub.valor = subValor.toFixed(2);
        salida.push(sub);
      }
      totalGeneral += subTotal;
      valorGeneral += subValor;
    }
    return {
      titulo: "Stock por galpón y sabor",
      filtros: [
        ...(await filtrosDe(p, usa)),
        { etiqueta: "Días de stock", valor: "stock ÷ venta diaria de los últimos 30 días" },
      ],
      orientacion: "apaisado",
      kpis: [
        { etiqueta: "Unidades en stock", valor: totalGeneral, tipo: "entero" },
        ...deps.map((d) => ({
          etiqueta: d.nombre,
          valor: totalesDep[d.id] ?? 0,
          tipo: "entero" as const,
        })),
        { etiqueta: "Bajo mínimo", valor: bajo, tipo: "entero" },
        { etiqueta: "Sin stock", valor: sin, tipo: "entero" },
        ...(ctx.finanzas
          ? [{ etiqueta: "Valor a costo", valor: valorGeneral.toFixed(2), tipo: "moneda" as const }]
          : []),
      ],
      secciones: [
        {
          id: "matriz",
          titulo: "Stock por producto, sabor y depósito",
          columnas,
          filas: salida,
          totales: {
            producto: "TOTAL",
            ...Object.fromEntries(deps.map((d) => [`dep_${d.id}`, totalesDep[d.id] ?? 0])),
            total: totalGeneral,
            ...(ctx.finanzas ? { valor: valorGeneral.toFixed(2) } : {}),
          },
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 4. Rotación y sabores muertos
// -----------------------------------------------------------------------------

const CLASE: Record<R.ClaseRotacion, string> = {
  RAPIDA: "Rápida",
  NORMAL: "Normal",
  LENTA: "Lenta",
  SIN_MOVIMIENTO: "Sin movimiento",
};

const rotacion: DefinicionReporte = {
  slug: "rotacion",
  numero: 4,
  titulo: "Rotación de inventario",
  descripcion: "Qué se mueve rápido, qué está lento y qué sabores no se venden (sabores muertos).",
  finanzas: false,
  filtros: ["periodo", "deposito", "categoria"],
  periodoPorDefecto: "30d",
  orientacion: "vertical",
  async construir(p, ctx) {
    const usa = this.filtros;
    const r = await R.rotacionInventario({ ...filtroReporte(p, usa), conValor: ctx.finanzas });
    const cols: ColumnaReporte[] = [
      col("nombre", "Producto — sabor", "texto", { ancho: 4 }),
      col("vendidas", "Vendidas", "entero"),
      col("stock", "Stock", "entero"),
      col("promedio", "Venta/día", "decimal"),
      col("dias", "Días de stock", "decimal"),
      col("clase", "Rotación", "texto", { ancho: 1.6 }),
      ...(ctx.finanzas ? [col("valor", "Stock a costo", "moneda")] : []),
    ];
    const aFila = (x: R.FilaRotacion): FilaReporte => ({
      nombre: x.nombre,
      vendidas: x.vendidas,
      stock: x.stock,
      promedio: x.promedioDiario,
      dias: x.diasDeStock,
      clase: CLASE[x.clase],
      valor: x.valorCosto ?? null,
      ...(x.clase === "SIN_MOVIMIENTO"
        ? { _alerta: "danger" as const }
        : x.clase === "LENTA"
          ? { _alerta: "warning" as const }
          : {}),
    });
    const muertos = r.filas.filter((x) => x.clase === "SIN_MOVIMIENTO");
    const orden = { SIN_MOVIMIENTO: 0, LENTA: 1, NORMAL: 2, RAPIDA: 3 };
    return {
      titulo: "Rotación de inventario",
      filtros: await filtrosDe(p, usa),
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Rápida", valor: r.resumen.RAPIDA, tipo: "entero" },
        { etiqueta: "Normal", valor: r.resumen.NORMAL, tipo: "entero" },
        { etiqueta: "Lenta", valor: r.resumen.LENTA, tipo: "entero" },
        { etiqueta: "Sin movimiento", valor: r.resumen.SIN_MOVIMIENTO, tipo: "entero" },
      ],
      secciones: [
        {
          id: "muertos",
          titulo: "Sabores muertos (con stock y sin ventas en el período)",
          columnas: cols,
          filas: muertos.map(aFila),
          vacio: "Ninguno: todo lo que tiene stock se vendió al menos una vez.",
        },
        {
          id: "rotacion",
          titulo: "Rotación por sabor",
          columnas: cols,
          filas: [...r.filas]
            .sort(
              (a, b) =>
                orden[a.clase] - orden[b.clase] || (b.diasDeStock ?? 0) - (a.diasDeStock ?? 0),
            )
            .map(aFila),
        },
      ],
      nota: `Días de stock = stock ÷ venta diaria promedio del período (${r.dias} días). Rápida y lenta según Configuración → Caja y reportes.`,
    };
  },
};

// -----------------------------------------------------------------------------
// 5. Valorización (FINANZAS)
// -----------------------------------------------------------------------------

const valorizacion: DefinicionReporte = {
  slug: "valorizacion",
  numero: 5,
  titulo: "Valorización de inventario",
  descripcion: "Stock valuado a costo y a precio de venta, por depósito y por categoría.",
  finanzas: true,
  filtros: ["deposito"],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p) {
    const usa = this.filtros;
    const v = await R.valorizacionInventario({ depositoId: p.depositoId });
    const cols = (t: string): ColumnaReporte[] => [
      col("nombre", t, "texto"),
      col("unidades", "Unidades", "entero"),
      col("valorCosto", "A costo", "moneda"),
      col("valorVenta", "A venta", "moneda"),
      col("gananciaPotencial", "Ganancia potencial", "moneda"),
      col("margen", "Margen", "porcentaje"),
    ];
    return {
      titulo: "Valorización de inventario",
      filtros: [
        ...(await filtrosDe(p, usa)),
        { etiqueta: "Precios", valor: "costo y venta actuales" },
      ],
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Unidades", valor: v.total.unidades, tipo: "entero" },
        { etiqueta: "Valor a costo", valor: v.total.valorCosto, tipo: "moneda" },
        { etiqueta: "Valor a venta", valor: v.total.valorVenta, tipo: "moneda" },
        { etiqueta: "Ganancia potencial", valor: v.total.gananciaPotencial, tipo: "moneda" },
      ],
      graficos: [
        {
          id: "categorias",
          tipo: "barrasH",
          titulo: "Valor a costo por categoría",
          x: "nombre",
          formato: "moneda",
          series: [{ clave: "valor", nombre: "A costo" }],
          datos: v.porCategoria.map((c) => ({ nombre: c.nombre, valor: Number(c.valorCosto) })),
        },
      ],
      secciones: [
        {
          id: "depositos",
          titulo: "Por depósito",
          columnas: cols("Depósito"),
          filas: v.porDeposito.map((x) => ({ ...x })),
          totales: { nombre: "Total", ...v.total },
        },
        {
          id: "categorias",
          titulo: "Por categoría",
          columnas: cols("Categoría"),
          filas: v.porCategoria.map((x) => ({ ...x })),
          totales: { nombre: "Total", ...v.total },
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 6. Movimientos de stock (auditoría de ajustes)
// -----------------------------------------------------------------------------

const movimientos: DefinicionReporte = {
  slug: "movimientos",
  numero: 6,
  titulo: "Movimientos de stock",
  descripcion: "Entradas y salidas por tipo y ajustes por usuario (auditoría de faltantes).",
  finanzas: false,
  filtros: ["periodo", "deposito"],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p, ctx) {
    const usa = this.filtros;
    const m = await R.movimientosPorTipo({ ...filtroReporte(p, usa), conValor: ctx.finanzas });
    const valor = ctx.finanzas ? [col("valor", "Valor a costo", "moneda")] : [];
    const negativos = m.porTipo.find((x) => x.tipo === "AJUSTE_NEGATIVO");
    return {
      titulo: "Movimientos de stock",
      filtros: await filtrosDe(p, usa),
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Unidades que entraron", valor: m.entradas, tipo: "entero" },
        { etiqueta: "Unidades que salieron", valor: m.salidas, tipo: "entero" },
        { etiqueta: "Ajustes negativos", valor: negativos?.movimientos ?? 0, tipo: "entero" },
        { etiqueta: "Unidades ajustadas (−)", valor: negativos?.unidades ?? 0, tipo: "entero" },
      ],
      secciones: [
        {
          id: "tipos",
          titulo: "Por tipo de movimiento",
          columnas: [
            col("tipo", "Tipo", "texto"),
            col("sentido", "Sentido", "texto", { ancho: 1.2 }),
            col("movimientos", "Movimientos", "entero"),
            col("unidades", "Unidades", "entero"),
            ...valor,
          ],
          filas: m.porTipo.map((x) => ({
            ...x,
            tipo: TIPO_MOVIMIENTO_UI[x.tipo].label,
            sentido: x.sentido === "entrada" ? "Entrada" : "Salida",
          })),
        },
        {
          id: "usuarios",
          titulo: "Ajustes e ingresos manuales por usuario",
          descripcion:
            "Muchos ajustes negativos de una misma persona = faltante de mercadería o errores de carga.",
          columnas: [
            col("usuario", "Usuario", "texto"),
            col("tipo", "Tipo", "texto"),
            col("movimientos", "Movimientos", "entero"),
            col("unidades", "Unidades", "entero"),
            ...valor,
          ],
          filas: m.porUsuario.map((x) => ({
            ...x,
            tipo: TIPO_MOVIMIENTO_UI[x.tipo].label,
            ...(x.tipo === "AJUSTE_NEGATIVO" ? { _alerta: "warning" as const } : {}),
          })),
          vacio: "Sin ajustes en el período.",
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 7. Compras por proveedor y evolución de costos (FINANZAS)
// -----------------------------------------------------------------------------

const compras: DefinicionReporte = {
  slug: "compras",
  numero: 7,
  titulo: "Compras y costos",
  descripcion: "Compras por proveedor y cómo evolucionaron los costos.",
  finanzas: true,
  filtros: ["periodo", "deposito"],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p) {
    const usa = this.filtros;
    const f = filtroReporte(p, usa);
    const [c, variacion, evolucion, variante] = await Promise.all([
      R.comprasPorProveedor(f),
      R.variacionCostos(f),
      p.varianteId ? R.evolucionCostos(p.varianteId) : Promise.resolve(null),
      p.varianteId
        ? prisma.variante.findUnique({
            where: { id: p.varianteId },
            select: { nombre: true, producto: { select: { nombre: true, tieneVariantes: true } } },
          })
        : Promise.resolve(null),
    ]);
    return {
      titulo: "Compras por proveedor y evolución de costos",
      filtros: await filtrosDe(p, usa),
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Total comprado", valor: c.total, tipo: "moneda" },
        {
          etiqueta: "Compras recibidas",
          valor: c.proveedores.reduce((a, x) => a + x.compras, 0),
          tipo: "entero",
        },
        {
          etiqueta: "Unidades",
          valor: c.proveedores.reduce((a, x) => a + x.unidades, 0),
          tipo: "entero",
        },
        { etiqueta: "Sabores con cambio de costo", valor: variacion.length, tipo: "entero" },
      ],
      secciones: [
        {
          id: "proveedores",
          titulo: "Por proveedor",
          columnas: [
            col("proveedor", "Proveedor", "texto"),
            col("compras", "Compras", "entero"),
            col("unidades", "Unidades", "entero"),
            col("total", "Total", "moneda"),
            col("porcentaje", "%", "porcentaje"),
            col("ultima", "Última", "fecha"),
          ],
          filas: c.proveedores.map((x) => ({ ...x, ultima: x.ultima?.toISOString() ?? null })),
          totales: { proveedor: "Total", total: c.total, porcentaje: 100 },
        },
        {
          id: "costos",
          titulo: "Variación de costos en el período",
          columnas: [
            col("nombre", "Producto — sabor", "texto", { ancho: 4, enlace: "href" }),
            col("cambios", "Cambios", "entero"),
            col("costoInicial", "Costo inicial", "moneda"),
            col("costoFinal", "Costo final", "moneda"),
            col("variacion", "Variación", "porcentaje"),
          ],
          filas: variacion.map((x) => ({ ...x, href: `?variante=${x.varianteId}` })),
          vacio: "No hubo cambios de costo en el período.",
        },
        ...(evolucion && variante
          ? [
              {
                id: "evolucion",
                titulo: `Evolución de costos: ${nombreCompleto(variante.producto.nombre, variante.nombre, variante.producto.tieneVariantes)}`,
                columnas: [
                  col("fecha", "Fecha", "fechaHora"),
                  col("costoAnterior", "Costo antes", "moneda"),
                  col("costoNuevo", "Costo nuevo", "moneda"),
                  col("variacionCosto", "Var.", "porcentaje"),
                  col("ventaNueva", "Precio venta", "moneda"),
                  col("usuario", "Usuario", "texto"),
                  col("motivo", "Motivo", "texto"),
                ],
                filas: evolucion.map((x) => ({ ...x, fecha: x.fecha.toISOString() })),
                vacio: "Sin cambios de precio registrados.",
              },
            ]
          : []),
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 8. Gastos (GASTOS)
// -----------------------------------------------------------------------------

const gastos: DefinicionReporte = {
  slug: "gastos",
  numero: 8,
  titulo: "Gastos por categoría y mes",
  descripcion: "En qué se va la plata: por categoría, por mes y el detalle.",
  finanzas: false,
  modulo: Modulo.GASTOS,
  filtros: ["periodo", "deposito"],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p) {
    const usa = this.filtros;
    const f = filtroReporte(p, usa);
    const [cats, meses, detalle] = await Promise.all([
      gastosPorCategoria(f),
      gastosPorMes(f),
      listarGastos({
        desde: f.desde,
        hasta: f.hasta,
        depositoId: f.depositoId,
        page: 1,
        pageSize: 5000,
      }),
    ]);
    const total = cats.reduce((a, c) => a + Number(c.total), 0);
    return {
      titulo: "Gastos por categoría y mes",
      filtros: await filtrosDe(p, usa),
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Total de gastos", valor: total.toFixed(2), tipo: "moneda" },
        { etiqueta: "Cantidad", valor: detalle.total, tipo: "entero" },
        { etiqueta: "Categoría principal", valor: cats[0]?.categoria ?? "—", tipo: "texto" },
      ],
      graficos: [
        {
          id: "categorias",
          tipo: "barrasH",
          titulo: "Gastos por categoría",
          x: "categoria",
          formato: "moneda",
          series: [{ clave: "total", nombre: "Total" }],
          datos: cats.map((c) => ({ categoria: c.categoria, total: Number(c.total) })),
        },
      ],
      secciones: [
        {
          id: "categorias",
          titulo: "Por categoría",
          columnas: [
            col("categoria", "Categoría", "texto"),
            col("cantidad", "Gastos", "entero"),
            col("total", "Total", "moneda"),
            col("porcentaje", "%", "porcentaje"),
          ],
          filas: cats.map((c) => ({
            ...c,
            porcentaje: total ? Math.round((Number(c.total) / total) * 1000) / 10 : null,
          })),
          totales: { categoria: "Total", total: total.toFixed(2), porcentaje: 100 },
        },
        {
          id: "meses",
          titulo: "Por mes",
          columnas: [
            col("mes", "Mes", "texto", { ancho: 1 }),
            col("categoria", "Categoría", "texto"),
            col("total", "Total", "moneda"),
          ],
          filas: meses.map((m) => ({ ...m, mes: `${m.mes.slice(5, 7)}/${m.mes.slice(0, 4)}` })),
        },
        {
          id: "detalle",
          titulo: "Detalle",
          columnas: [
            col("fecha", "Fecha", "fecha", { ancho: 1 }),
            col("categoria", "Categoría", "texto", { ancho: 1.4 }),
            col("descripcion", "Descripción", "texto"),
            col("medio", "Medio", "texto", { ancho: 1.3 }),
            col("deposito", "Depósito", "texto", { ancho: 1.3 }),
            col("monto", "Monto", "moneda"),
          ],
          filas: detalle.gastos.map((g) => ({
            fecha: g.fecha.toISOString(),
            categoria: g.categoria,
            descripcion: g.descripcion + (g.recurrente ? " (recurrente)" : ""),
            medio: ETIQUETA_MEDIO_PAGO[g.medioPago as MedioPago],
            deposito: g.deposito ?? "General",
            monto: g.monto,
          })),
          totales: { descripcion: "Total", monto: detalle.totalMonto },
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 9. Cuentas por cobrar (CLIENTES)
// -----------------------------------------------------------------------------

const cuentas: DefinicionReporte = {
  slug: "cuentas-por-cobrar",
  numero: 9,
  titulo: "Cuentas por cobrar",
  descripcion: "Quién debe, cuánto y desde hace cuánto (0–30, 31–60, más de 60 días).",
  finanzas: false,
  modulo: Modulo.CLIENTES,
  filtros: [],
  periodoPorDefecto: "mes",
  orientacion: "vertical",
  async construir(p) {
    const c = await R.cuentasPorCobrar();
    return {
      titulo: "Cuentas por cobrar",
      filtros: [
        {
          etiqueta: "Al",
          valor: new Date().toLocaleDateString("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
          }),
        },
      ],
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Total a cobrar", valor: c.total.saldo, tipo: "moneda" },
        { etiqueta: "0 a 30 días", valor: c.total.d0_30, tipo: "moneda" },
        { etiqueta: "31 a 60 días", valor: c.total.d31_60, tipo: "moneda" },
        { etiqueta: "Más de 60 días", valor: c.total.d60, tipo: "moneda" },
      ],
      secciones: [
        {
          id: "clientes",
          titulo: "Clientes con saldo deudor",
          columnas: [
            col("nombre", "Cliente", "texto", { enlace: "href" }),
            col("telefono", "Teléfono", "texto", { ancho: 1.6 }),
            col("ventas", "Ventas", "entero", { ancho: 0.9 }),
            col("masVieja", "Desde", "fecha", { ancho: 1.1 }),
            col("d0_30", "0–30 d", "moneda"),
            col("d31_60", "31–60 d", "moneda"),
            col("d60", "+60 d", "moneda"),
            col("saldo", "Total", "moneda"),
          ],
          filas: c.clientes.map((x) => ({
            ...x,
            href: `/clientes/${x.clienteId}`,
            masVieja: x.masVieja?.toISOString() ?? null,
            ...(Number(x.d60) > 0
              ? { _alerta: "danger" as const }
              : Number(x.d31_60) > 0
                ? { _alerta: "warning" as const }
                : {}),
          })),
          totales: { nombre: "Total", ...c.total },
          vacio: "Nadie debe nada.",
        },
      ],
    };
    void p;
  },
};

// -----------------------------------------------------------------------------
// 10. Cierres de caja
// -----------------------------------------------------------------------------

const cajas: DefinicionReporte = {
  slug: "cierres-de-caja",
  numero: 10,
  titulo: "Cierres de caja",
  descripcion: "Histórico de arqueos con sus diferencias y el efectivo cobrado fuera de caja.",
  finanzas: false,
  filtros: ["periodo", "deposito", "diferencia"],
  periodoPorDefecto: "mes",
  orientacion: "apaisado",
  async construir(p, ctx) {
    const usa = this.filtros;
    const [r, fuera] = await Promise.all([
      listarCajas(
        {
          depositoId: p.depositoId,
          desde: p.rango.desde,
          hasta: p.rango.hasta,
          conDiferencia: p.soloConDiferencia,
          page: 1,
          pageSize: 5000,
        },
        ctx.tz,
      ),
      R.efectivoFueraDeCaja({ ...p.rango, depositoId: p.depositoId }, ctx.tz),
    ]);
    const cerradas = r.cajas.filter((c) => c.estado === "CERRADA");
    const conDif = cerradas.filter((c) => Number(c.diferencia) !== 0);
    const neto = cerradas.reduce((a, c) => a + Number(c.diferencia ?? 0), 0);
    return {
      titulo: "Cierres de caja",
      filtros: await filtrosDe(p, usa),
      orientacion: "apaisado",
      kpis: [
        { etiqueta: "Cierres", valor: cerradas.length, tipo: "entero" },
        { etiqueta: "Con diferencia", valor: conDif.length, tipo: "entero" },
        {
          etiqueta: "Para revisar",
          valor: cerradas.filter((c) => c.requiereRevision).length,
          tipo: "entero",
        },
        { etiqueta: "Diferencia neta", valor: neto.toFixed(2), tipo: "moneda" },
        { etiqueta: "Efectivo fuera de caja", valor: fuera.total, tipo: "moneda" },
      ],
      secciones: [
        {
          id: "cierres",
          titulo: "Cajas",
          columnas: [
            col("deposito", "Depósito", "texto", { ancho: 1.3, enlace: "href" }),
            col("abiertaAt", "Apertura", "fechaHora"),
            col("abiertaPor", "Abrió", "texto", { ancho: 1.3 }),
            col("cerradaAt", "Cierre", "fechaHora"),
            col("cerradaPor", "Cerró", "texto", { ancho: 1.3 }),
            col("montoInicial", "Inicial", "moneda"),
            col("montoEsperado", "Esperado", "moneda"),
            col("montoContado", "Contado", "moneda"),
            col("diferencia", "Diferencia", "moneda"),
            col("observaciones", "Observaciones", "texto", { ancho: 3 }),
          ],
          filas: r.cajas.map((c) => ({
            ...c,
            requiereRevision: c.requiereRevision ? "Sí" : "No",
            href: `/caja/${c.id}`,
            abiertaAt: c.abiertaAt.toISOString(),
            cerradaAt: c.cerradaAt?.toISOString() ?? null,
            observaciones:
              c.estado === "ABIERTA"
                ? "Abierta"
                : (c.observaciones ?? (c.requiereRevision ? "Para revisar" : null)),
            ...(c.requiereRevision
              ? { _alerta: "danger" as const }
              : Number(c.diferencia ?? 0) !== 0
                ? { _alerta: "warning" as const }
                : {}),
          })),
          totales: { deposito: "Total", diferencia: neto.toFixed(2) },
          vacio: "No hay cajas en el período.",
        },
      ],
    };
  },
};

// -----------------------------------------------------------------------------
// 11. Resumen mensual (FINANZAS) — el PDF del 1° de cada mes
// -----------------------------------------------------------------------------

const resumen: DefinicionReporte = {
  slug: "resumen-mensual",
  numero: 11,
  titulo: "Resumen mensual",
  descripcion:
    "Un solo PDF con KPIs, gráfico, top 10, gastos y ganancia neta, listo para WhatsApp.",
  finanzas: true,
  filtros: ["periodo", "deposito"],
  periodoPorDefecto: "mes-anterior",
  orientacion: "vertical",
  async construir(p) {
    const usa = this.filtros;
    const f = filtroReporte(p, usa);
    const [k, serie, top, cats, medios] = await Promise.all([
      R.kpis(f),
      R.serieTemporal({ ...f, granularidad: R.granularidadPara(f) }),
      R.rankingVariantes({ ...f, orden: "unidades", limit: 10 }),
      gastosPorCategoria(f),
      R.ventasPorMedioPago(f),
    ]);
    const gran = R.granularidadPara(f);
    const margenDevuelto =
      Number(k.gananciaBruta.actual) - Number(k.gastos.actual) - Number(k.gananciaNeta.actual);
    return {
      titulo: "Resumen del mes",
      subtitulo: etiquetaRango(p),
      filtros: [
        ...(await filtrosDe(p, usa)),
        {
          etiqueta: "Comparado con",
          valor: etiquetaRango({ periodo: "personalizado", rango: k.periodoAnterior }),
        },
      ],
      orientacion: "vertical",
      kpis: [
        { etiqueta: "Ventas", valor: k.ventas.actual, tipo: "moneda", delta: k.ventas.delta },
        {
          etiqueta: "Ganancia bruta",
          valor: k.gananciaBruta.actual,
          tipo: "moneda",
          delta: k.gananciaBruta.delta,
        },
        {
          etiqueta: "Gastos",
          valor: k.gastos.actual,
          tipo: "moneda",
          delta: k.gastos.delta,
          deltaInvertido: true,
        },
        {
          etiqueta: "Ganancia neta",
          valor: k.gananciaNeta.actual,
          tipo: "moneda",
          delta: k.gananciaNeta.delta,
        },
        {
          etiqueta: "Cantidad de ventas",
          valor: Number(k.cantidadVentas.actual),
          tipo: "entero",
          delta: k.cantidadVentas.delta,
        },
        {
          etiqueta: "Ticket promedio",
          valor: k.ticketPromedio.actual,
          tipo: "moneda",
          delta: k.ticketPromedio.delta,
        },
        {
          etiqueta: "Unidades",
          valor: Number(k.unidades.actual),
          tipo: "entero",
          delta: k.unidades.delta,
        },
        {
          etiqueta: "Margen bruto",
          valor: k.margen.actual,
          tipo: "porcentaje",
          delta: k.margen.delta,
        },
      ],
      graficos: [
        {
          id: "serie",
          tipo: "barras",
          titulo: `Ventas y ganancia bruta por ${gran === "dia" ? "día" : gran}`,
          x: "periodo",
          formato: "moneda",
          series: [
            { clave: "ventas", nombre: "Ventas" },
            { clave: "ganancia", nombre: "Ganancia bruta" },
          ],
          datos: serie.map((s) => ({
            periodo: etiquetaPeriodo(s.periodo, gran),
            ventas: Number(s.ventas),
            ganancia: Number(s.gananciaBruta),
          })),
          enPdf: true,
        },
      ],
      secciones: [
        {
          id: "resultado",
          titulo: "Resultado del período",
          columnas: [
            col("concepto", "Concepto", "texto", { ancho: 4 }),
            col("monto", "Monto", "moneda", { ancho: 2 }),
          ],
          filas: [
            { concepto: "Ventas", monto: k.ventas.actual },
            {
              concepto: "Costo de lo vendido",
              monto: (-(Number(k.ventas.actual) - Number(k.gananciaBruta.actual))).toFixed(2),
            },
            { concepto: "Ganancia bruta", monto: k.gananciaBruta.actual, _estilo: "subtotal" },
            { concepto: "Margen perdido por devoluciones", monto: (-margenDevuelto).toFixed(2) },
            { concepto: "Gastos", monto: (-Number(k.gastos.actual)).toFixed(2) },
          ],
          totales: { concepto: "GANANCIA NETA", monto: k.gananciaNeta.actual },
        },
        {
          id: "top",
          titulo: "Top 10 sabores",
          columnas: [
            col("nombre", "Producto — sabor", "texto", { ancho: 4 }),
            col("unidades", "Unidades", "entero"),
            col("facturacion", "Facturación", "moneda"),
            col("ganancia", "Ganancia", "moneda"),
          ],
          filas: top.map((x) => ({ ...x })),
        },
        {
          id: "gastos",
          titulo: "Gastos por categoría",
          columnas: [
            col("categoria", "Categoría", "texto", { ancho: 4 }),
            col("cantidad", "Gastos", "entero"),
            col("total", "Total", "moneda"),
          ],
          filas: cats.map((c) => ({ ...c })),
          totales: { categoria: "Total", total: k.gastos.actual },
        },
        {
          id: "medios",
          titulo: "Cobrado por medio de pago",
          columnas: [
            col("medio", "Medio", "texto", { ancho: 4 }),
            col("total", "Total", "moneda"),
            col("porcentaje", "%", "porcentaje"),
          ],
          filas: medios.medios.map((m) => ({
            medio: ETIQUETA_MEDIO_PAGO[m.medioPago],
            total: m.total,
            porcentaje: m.porcentaje,
          })),
          totales: { medio: "Total", total: medios.total },
        },
      ],
    };
  },
};

export const REPORTES: readonly DefinicionReporte[] = [
  ventas,
  ganancias,
  stock,
  rotacion,
  valorizacion,
  movimientos,
  compras,
  gastos,
  cuentas,
  cajas,
  resumen,
];

export function reportePorSlug(slug: string): DefinicionReporte | null {
  return REPORTES.find((r) => r.slug === slug) ?? null;
}

export async function contextoReporte(u: SujetoPermisos): Promise<ContextoReporte> {
  return { finanzas: puede(u, Modulo.FINANZAS, "ver"), tz: await obtenerZonaHoraria() };
}

export type { GraficoReporte };
