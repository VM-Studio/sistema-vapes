/**
 * SEED DEMO — 90 días de operación simulada en los tres paneles, para probar
 * el dashboard, el rendimiento del equipo, los reportes y los listados.
 *
 * - Vapes (mucho volumen): 5 marcas, 15 productos con sabores, 3 proveedores
 *   con precios distintos para los mismos productos (uno en USD) y cambios de
 *   precio a lo largo del período (historial), 20 compras recibidas, 300
 *   ventas repartidas entre Juan Cruz, Agustina y Trinidad (unitarias y
 *   mayoristas; algunas mayoristas salen de convertir una cotización), 80
 *   clientes, 12 garantías, 20 cotizaciones en todos los estados, ajustes,
 *   transferencias y la cotización del dólar (`cotizacionUsd`).
 * - Cosmetic y Especiales: lo mismo en chico (solo venden los dueños).
 *
 * La operación no inserta filas "a mano": fija el reloj de negocio
 * (src/lib/reloj.ts) en cada momento simulado y llama a los MISMOS servicios
 * que la app (generarVenta, compras, garantías, cotizaciones, precios de
 * proveedor, ajustes, transferencias) con `ctx = { panelId, usuarioId }`. Así
 * los triggers, la numeración por panel, el último costo de cada sabor, el
 * historial de precios y el ledger se ejercitan de verdad.
 *
 * Uso (sobre una DB con el seed base): pnpm db:seed-demo
 * o: bash scripts/db-descartable.sh gestion_demo --demo
 * Si la demo ya está cargada (existe su catálogo en Vapes), no hace nada.
 * Determinístico: PRNG con semilla fija.
 */
import { MedioPago, Moneda, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";

import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { ahora, fijarReloj } from "../src/lib/reloj";
import { crearClienteSchema, normalizarTelefono } from "../src/lib/validations/cliente";
import { registrarDevolucionSchema } from "../src/lib/validations/devolucion";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { diaEn, inicioDia, sumarDias, ZONA_DEFAULT, type DiaISO } from "../src/lib/zona-horaria";
import { dbPara, transaccion, type Ctx } from "../src/server/db/panel-scoped";
import { DomainError } from "../src/server/errors";
import { crearCliente } from "../src/server/services/cliente.service";
import { crearCompra, recibirCompra } from "../src/server/services/compra.service";
import {
  convertirEnVenta,
  crearCotizacion,
  listar as listarCotizaciones,
  marcarAceptada,
  marcarEnviada,
  marcarRechazada,
} from "../src/server/services/cotizacion.service";
import { anularDevolucion, registrarDevolucion } from "../src/server/services/devolucion.service";
import {
  completarTransferencia,
  crearTransferencia,
  registrarAjuste,
} from "../src/server/services/movimiento.service";
import { calcularPrecios } from "../src/server/services/precio.service";
import { generarSku } from "../src/server/services/producto.service";
import { asignarProducto } from "../src/server/services/proveedor.service";
import { registrarMovimiento } from "../src/server/services/stock.service";
import {
  anularVenta,
  generarVenta,
  type VentaGenerada,
} from "../src/server/services/venta.service";

/**
 * En producción el seed NO corre (crea datos ficticios): solo con
 * ALLOW_SEED=true sobre una base de prueba.
 */
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
  console.error(
    "✘ seed demo bloqueado en producción (definí ALLOW_SEED=true si de verdad es una base de prueba).",
  );
  process.exit(1);
}

const DIAS = 90;
const META = { ip: "127.0.0.1", userAgent: "seed-demo" };
const TZ = ZONA_DEFAULT;
/** Pesos por dólar (config `cotizacionUsd` de Vapes). */
const COTIZACION_USD = 1250;

// -----------------------------------------------------------------------------
// PRNG determinístico (mulberry32)
// -----------------------------------------------------------------------------
let semilla = 20261002;
function azar(): number {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (a: number, b: number) => a + Math.floor(azar() * (b - a + 1));
const elegir = <T>(xs: readonly T[]): T => xs[Math.floor(azar() * xs.length)]!;
function ponderado<T>(xs: readonly { valor: T; peso: number }[]): T {
  const total = xs.reduce((a, x) => a + x.peso, 0);
  let r = azar() * total;
  for (const x of xs) if ((r -= x.peso) <= 0) return x.valor;
  return xs[xs.length - 1]!.valor;
}
function mezclar<T>(xs: readonly T[]): T[] {
  const r = [...xs];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

// -----------------------------------------------------------------------------
// Datos de cada panel
// -----------------------------------------------------------------------------

interface ProductoDemo {
  marca: string;
  modelo: string;
  /** La especificación del panel (pitadas, contenido...); "" si no aplica. */
  especificacion: string;
  categoria?: string;
  costo: number;
  venta: number;
  minimo: number;
  /** Stock inicial por galpón (en el orden de los galpones del panel). */
  stock: number[];
  /** Popularidad de cada sabor (0 = nunca se vende). "Único" si no tiene sabor. */
  sabores: { nombre: string; peso: number; precioPropio?: number }[];
}

interface ProveedorDemo {
  nombre: string;
  nombreTienda: string;
  telefono: string;
  notas?: string;
  /** Precio por producto (nombre completo). */
  precios: { producto: string; precio: number; moneda?: Moneda }[];
}

interface CambioPrecioDemo {
  /** Días antes de hoy. */
  haceDias: number;
  proveedor: string;
  producto: string;
  precio: number;
  moneda?: Moneda;
}

type EstadoCotizacionDemo =
  "CONVERTIDA" | "VENCIDA" | "RECHAZADA" | "ACEPTADA" | "ENVIADA" | "BORRADOR";

interface PanelDemo {
  panelId: string;
  /** Primer dígito de los EAN y teléfonos demo del panel (no se pisan entre paneles). */
  codigo: number;
  /** Productos a crear (en Vapes se suman a los del seed base). */
  productos: ProductoDemo[];
  /** Marcas/categorías nuevas (las demás ya existen por el seed base). */
  categorias: string[];
  proveedores: ProveedorDemo[];
  cambiosPrecio: CambioPrecioDemo[];
  clientes: number;
  ventas: number;
  /** Probabilidad de que una venta de un dueño sea mayorista. */
  mayoristas: number;
  compras: number;
  garantias: number;
  cotizaciones: { estado: EstadoCotizacionDemo; haceDias: number; mayorista: boolean }[];
  /** Nombres de los vendedores (del seed base) con su peso. */
  vendedores: { nombre: string; peso: number }[];
  ajustes: number;
  transferencias: boolean;
}

const sabores = (nombres: string[], pesos: number[]) =>
  nombres.map((nombre, i) => ({ nombre, peso: pesos[i] ?? 1 }));

const VAPES: PanelDemo = {
  panelId: "pnl_vapes",
  codigo: 1,
  categorias: [],
  productos: [
    {
      marca: "Lost Mary",
      modelo: "MO",
      especificacion: "5000",
      categoria: "Vapes",
      costo: 8800,
      venta: 15500,
      minimo: 8,
      stock: [25, 12],
      sabores: [
        { nombre: "Blue Razz", peso: 9, precioPropio: 16000 },
        { nombre: "Watermelon", peso: 7 },
        { nombre: "Grape", peso: 4 },
        { nombre: "Peach Ice", peso: 3 },
        // Nunca se vende: queda como producto sin movimiento.
        { nombre: "Café Tabaco", peso: 0 },
      ],
    },
    {
      marca: "Lost Mary",
      modelo: "OS",
      especificacion: "5000",
      categoria: "Vapes",
      costo: 8500,
      venta: 15000,
      minimo: 6,
      stock: [20, 10],
      sabores: sabores(["Strawberry Kiwi", "Cola Ice", "Pineapple Mango"], [4, 3, 2]),
    },
    {
      marca: "Lost Mary",
      modelo: "MT",
      especificacion: "15000",
      categoria: "Vapes",
      costo: 14000,
      venta: 24000,
      minimo: 5,
      stock: [18, 8],
      sabores: sabores(
        ["Miami Mint", "Triple Berry", "Lime Grapefruit", "Cherry Ice"],
        [5, 4, 2, 2],
      ),
    },
    {
      marca: "Geek Bar",
      modelo: "Pulse",
      especificacion: "15000",
      categoria: "Vapes",
      costo: 13500,
      venta: 23000,
      minimo: 6,
      stock: [30, 12],
      sabores: sabores(
        ["Sour Apple Ice", "Watermelon Ice", "Mexican Mango", "Blue Razz Ice", "Strawberry Banana"],
        [8, 7, 6, 5, 3],
      ),
    },
    {
      marca: "Geek Bar",
      modelo: "Meloso",
      especificacion: "9000",
      categoria: "Vapes",
      costo: 10200,
      venta: 18000,
      minimo: 5,
      stock: [20, 8],
      sabores: sabores(["Peach Ice", "Juicy Grape", "Miami Mint"], [3, 3, 2]),
    },
    {
      marca: "Ignite",
      modelo: "V50",
      especificacion: "5000",
      categoria: "Vapes",
      costo: 8000,
      venta: 14000,
      minimo: 6,
      stock: [24, 10],
      sabores: sabores(["Menthol", "Grape Ice", "Passion Fruit"], [3, 2, 2]),
    },
    {
      marca: "Ignite",
      modelo: "V120",
      especificacion: "12000",
      categoria: "Vapes",
      costo: 12500,
      venta: 21000,
      minimo: 5,
      stock: [20, 10],
      sabores: sabores(["Banana Ice", "Cactus Lime", "Tropical Açaí"], [3, 2, 2]),
    },
    {
      marca: "Elf Bar",
      modelo: "TE",
      especificacion: "6000",
      categoria: "Vapes",
      costo: 9500,
      venta: 16500,
      minimo: 6,
      stock: [22, 10],
      sabores: sabores(["Kiwi Passion", "Rainbow Candy", "Strawberry Ice"], [3, 3, 2]),
    },
    {
      marca: "Elf Bar",
      modelo: "GH",
      especificacion: "23000",
      categoria: "Vapes",
      costo: 16000,
      venta: 27000,
      minimo: 4,
      stock: [16, 6],
      sabores: sabores(["Blueberry Ice", "Watermelon Ice", "Cherry Lemon"], [2, 2, 1]),
    },
    {
      marca: "TechPro",
      modelo: "Cable USB-C 1m",
      especificacion: "",
      categoria: "Accesorios",
      costo: 2000,
      venta: 4500,
      minimo: 5,
      stock: [20, 10],
      sabores: [{ nombre: "Único", peso: 2 }],
    },
  ],
  proveedores: [
    // Los dos del seed base (se completan sus listas) y uno nuevo.
    {
      nombre: "Lucas Fernández",
      nombreTienda: "Distribuidora Ejemplo",
      telefono: "11 5555-0000",
      precios: [
        { producto: "Lost Mary MO 5000", precio: 8800 },
        { producto: "Lost Mary OS 5000", precio: 8500 },
        { producto: "Geek Bar Pulse 15000", precio: 13900 },
        { producto: "Ignite V50 5000", precio: 8000 },
        { producto: "Ignite V120 12000", precio: 12800 },
        { producto: "Elf Bar TE 6000", precio: 9500 },
        { producto: "TechPro Cable USB-C 1m", precio: 2000 },
      ],
    },
    {
      nombre: "Sofía Ríos",
      nombreTienda: "Vape Import Once",
      telefono: "11 5555-0001",
      precios: [
        { producto: "Elf Bar BC 5000", precio: 8100 },
        { producto: "Lost Mary MO 5000", precio: 8600 },
        { producto: "Lost Mary MT 15000", precio: 11.5, moneda: Moneda.USD },
        { producto: "Geek Bar Pulse 15000", precio: 10.8, moneda: Moneda.USD },
        { producto: "Geek Bar Meloso 9000", precio: 10200 },
        { producto: "Elf Bar GH 23000", precio: 12.9, moneda: Moneda.USD },
      ],
    },
    {
      nombre: "Martina Vega",
      nombreTienda: "Importadora Vapor Sur",
      telefono: "11 4444-0001",
      notas: "Entrega en 48 h. Mínimo 20 unidades por pedido.",
      precios: [
        { producto: "Ignite V80 8000", precio: 9700 },
        { producto: "Elf Bar BC 5000", precio: 8350 },
        { producto: "Elf Bar BC 10000", precio: 11200 },
        { producto: "Lost Mary MO 5000", precio: 9100 },
        { producto: "Lost Mary MT 15000", precio: 14000 },
        { producto: "Geek Bar Pulse 15000", precio: 13500 },
        { producto: "Geek Bar Meloso 9000", precio: 10500 },
        { producto: "Ignite V50 5000", precio: 7800 },
        { producto: "Ignite V120 12000", precio: 12500 },
        { producto: "Elf Bar TE 6000", precio: 9900 },
        { producto: "Elf Bar GH 23000", precio: 16000 },
        { producto: "TechPro Cargador USB-C 20W", precio: 4700 },
      ],
    },
  ],
  cambiosPrecio: [
    { haceDias: 70, proveedor: "Martina Vega", producto: "Ignite V80 8000", precio: 9900 },
    { haceDias: 45, proveedor: "Lucas Fernández", producto: "Ignite V80 8000", precio: 10200 },
    { haceDias: 44, proveedor: "Martina Vega", producto: "Ignite V80 8000", precio: 10400 },
    {
      haceDias: 30,
      proveedor: "Sofía Ríos",
      producto: "Geek Bar Pulse 15000",
      precio: 11.2,
      moneda: Moneda.USD,
    },
    { haceDias: 21, proveedor: "Martina Vega", producto: "Geek Bar Pulse 15000", precio: 13200 },
    { haceDias: 12, proveedor: "Lucas Fernández", producto: "Lost Mary MO 5000", precio: 9200 },
    { haceDias: 5, proveedor: "Sofía Ríos", producto: "Elf Bar BC 5000", precio: 7900 },
  ],
  clientes: 80,
  ventas: 300,
  mayoristas: 0.14,
  compras: 20,
  garantias: 12,
  cotizaciones: [
    { estado: "CONVERTIDA", haceDias: 80, mayorista: true },
    { estado: "VENCIDA", haceDias: 72, mayorista: true },
    { estado: "CONVERTIDA", haceDias: 66, mayorista: true },
    { estado: "RECHAZADA", haceDias: 60, mayorista: false },
    { estado: "CONVERTIDA", haceDias: 51, mayorista: true },
    { estado: "VENCIDA", haceDias: 45, mayorista: false },
    { estado: "CONVERTIDA", haceDias: 38, mayorista: true },
    { estado: "RECHAZADA", haceDias: 31, mayorista: true },
    { estado: "CONVERTIDA", haceDias: 25, mayorista: false },
    { estado: "VENCIDA", haceDias: 19, mayorista: true },
    { estado: "CONVERTIDA", haceDias: 12, mayorista: true },
    { estado: "RECHAZADA", haceDias: 9, mayorista: false },
    { estado: "CONVERTIDA", haceDias: 4, mayorista: true },
    { estado: "ACEPTADA", haceDias: 3, mayorista: true },
    { estado: "ACEPTADA", haceDias: 2, mayorista: false },
    { estado: "ENVIADA", haceDias: 2, mayorista: true },
    { estado: "ENVIADA", haceDias: 1, mayorista: false },
    { estado: "ENVIADA", haceDias: 0, mayorista: true },
    { estado: "BORRADOR", haceDias: 1, mayorista: true },
    { estado: "BORRADOR", haceDias: 0, mayorista: false },
  ],
  vendedores: [
    { nombre: "Juan Cruz", peso: 35 },
    { nombre: "Agustina", peso: 30 },
    { nombre: "Trinidad", peso: 35 },
  ],
  ajustes: 4,
  transferencias: true,
};

const COSMETIC: PanelDemo = {
  panelId: "pnl_cosmetic",
  codigo: 2,
  categorias: ["Cuidado facial", "Cuidado corporal"],
  productos: [
    {
      marca: "Aurora",
      modelo: "Sérum Vitamina C",
      especificacion: "30ml",
      categoria: "Cuidado facial",
      costo: 6500,
      venta: 12900,
      minimo: 4,
      stock: [30],
      sabores: [{ nombre: "Único", peso: 5 }],
    },
    {
      marca: "Aurora",
      modelo: "Crema hidratante",
      especificacion: "50ml",
      categoria: "Cuidado facial",
      costo: 5200,
      venta: 9900,
      minimo: 4,
      stock: [25],
      sabores: sabores(["Piel seca", "Piel mixta"], [3, 2]),
    },
    {
      marca: "Lumina",
      modelo: "Body splash",
      especificacion: "250ml",
      categoria: "Cuidado corporal",
      costo: 3800,
      venta: 7500,
      minimo: 5,
      stock: [30],
      sabores: sabores(["Vainilla", "Coco", "Frutos rojos"], [4, 3, 2]),
    },
    {
      marca: "Lumina",
      modelo: "Labial mate",
      especificacion: "4g",
      costo: 2500,
      venta: 5900,
      minimo: 5,
      stock: [30],
      sabores: sabores(["Nude", "Rojo", "Coral"], [3, 3, 1]),
    },
  ],
  proveedores: [
    {
      nombre: "Carla Méndez",
      nombreTienda: "Belleza Mayorista",
      telefono: "11 4444-0201",
      precios: [
        { producto: "Aurora Sérum Vitamina C 30ml", precio: 6500 },
        { producto: "Aurora Crema hidratante 50ml", precio: 5200 },
        { producto: "Lumina Body splash 250ml", precio: 3800 },
        { producto: "Lumina Labial mate 4g", precio: 2500 },
      ],
    },
    {
      nombre: "Pablo Suárez",
      nombreTienda: "Cosmética Once",
      telefono: "11 4444-0202",
      precios: [
        { producto: "Aurora Sérum Vitamina C 30ml", precio: 6900 },
        { producto: "Lumina Body splash 250ml", precio: 3600 },
      ],
    },
  ],
  cambiosPrecio: [
    { haceDias: 40, proveedor: "Carla Méndez", producto: "Lumina Body splash 250ml", precio: 3950 },
  ],
  clientes: 18,
  ventas: 45,
  mayoristas: 0.08,
  compras: 4,
  garantias: 2,
  cotizaciones: [
    { estado: "CONVERTIDA", haceDias: 35, mayorista: true },
    { estado: "RECHAZADA", haceDias: 20, mayorista: false },
    { estado: "ENVIADA", haceDias: 1, mayorista: false },
  ],
  vendedores: [
    { nombre: "Juan Cruz", peso: 40 },
    { nombre: "Agustina", peso: 60 },
  ],
  ajustes: 1,
  transferencias: false,
};

const ESPECIALES: PanelDemo = {
  panelId: "pnl_especiales",
  codigo: 3,
  categorias: [],
  productos: [
    {
      marca: "Kaizen",
      modelo: "Encendedor recargable",
      especificacion: "Edición metal",
      costo: 4200,
      venta: 8900,
      minimo: 3,
      stock: [20],
      sabores: sabores(["Negro", "Plata"], [3, 2]),
    },
    {
      marca: "Kaizen",
      modelo: "Estuche de viaje",
      especificacion: "Cuero",
      costo: 7000,
      venta: 14500,
      minimo: 2,
      stock: [12],
      sabores: [{ nombre: "Único", peso: 2 }],
    },
    {
      marca: "Norte",
      modelo: "Kit regalo",
      especificacion: "Premium",
      costo: 15000,
      venta: 29000,
      minimo: 2,
      stock: [10],
      sabores: [{ nombre: "Único", peso: 1 }],
    },
  ],
  proveedores: [
    {
      nombre: "Hernán Ibarra",
      nombreTienda: "Regalería del Centro",
      telefono: "11 4444-0301",
      precios: [
        { producto: "Kaizen Encendedor recargable Edición metal", precio: 4200 },
        { producto: "Kaizen Estuche de viaje Cuero", precio: 7000 },
        { producto: "Norte Kit regalo Premium", precio: 15000 },
      ],
    },
  ],
  cambiosPrecio: [],
  clientes: 10,
  ventas: 20,
  mayoristas: 0,
  compras: 2,
  garantias: 1,
  cotizaciones: [
    { estado: "CONVERTIDA", haceDias: 15, mayorista: false },
    { estado: "BORRADOR", haceDias: 0, mayorista: false },
  ],
  vendedores: [
    { nombre: "Juan Cruz", peso: 50 },
    { nombre: "Agustina", peso: 50 },
  ],
  ajustes: 0,
  transferencias: false,
};

const NOMBRES = [
  "Sofía",
  "Julián",
  "Camila",
  "Matías",
  "Valentina",
  "Agustín",
  "Florencia",
  "Tomás",
  "Micaela",
  "Bruno",
  "Rocío",
  "Joaquín",
  "Paula",
  "Lautaro",
  "Martina",
  "Facundo",
];
const APELLIDOS = [
  "Ramírez",
  "Pereyra",
  "Torres",
  "Luna",
  "Sosa",
  "Benítez",
  "Castro",
  "Medina",
  "Rojas",
  "Acosta",
  "Molina",
  "Ríos",
];
const KIOSCOS = ["Kiosco El Paso", "Drugstore 24", "Kiosco La Esquina", "Maxikiosco Centro"];

const MEDIOS = [
  { valor: MedioPago.EFECTIVO, peso: 50 },
  { valor: MedioPago.TRANSFERENCIA, peso: 40 },
  { valor: MedioPago.BINANCE, peso: 10 },
] as const;

/** Fallas típicas que se cambian por garantía (observación ≥ 10 caracteres). */
const FALLAS = [
  "No enciende: la luz titila y no tira.",
  "Vino con pérdida de líquido en el envase.",
  "No carga con el cable original.",
  "Sabor a quemado desde la primera pitada.",
  "Se cortó a la mitad de uso sin motivo.",
];

// -----------------------------------------------------------------------------
// Simulación de un panel
// -----------------------------------------------------------------------------

interface VarianteDemo {
  id: string;
  productoId: string;
  producto: string;
  peso: number;
}

type Evento = { momento: Date; orden: number; hacer: () => Promise<void> };

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);

async function simularPanel(cfg: PanelDemo, ahoraReal: Date) {
  const db = dbPara(cfg.panelId);
  const usuarios = await prisma.usuario.findMany({
    where: { deletedAt: null, nombre: { in: cfg.vendedores.map((v) => v.nombre) } },
  });
  const usuario = (nombre: string) => {
    const u = usuarios.find((x) => x.nombre === nombre);
    if (!u) throw new Error(`Falta el usuario ${nombre}: corré primero el seed base.`);
    return u;
  };
  const dueno = usuario("Juan Cruz");
  const duena = usuario("Agustina");
  const esDueno = (u: { rol: RolUsuario }) => u.rol === RolUsuario.OWNER;
  const ctxDe = (u: { id: string }): Ctx => ({
    panelId: cfg.panelId,
    usuarioId: u.id,
    meta: META,
  });
  const ctxDueno = ctxDe(dueno);
  const vendedores = cfg.vendedores.map((v) => ({ valor: usuario(v.nombre), peso: v.peso }));

  const depositos = await db.deposito.findMany({
    where: { activo: true },
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  if (depositos.length === 0) throw new Error(`El panel ${cfg.panelId} no tiene galpones.`);
  const principal = depositos[0]!;

  const hoy = diaEn(ahoraReal, TZ);
  const primerDia = sumarDias(hoy, -(DIAS - 1));
  const en = (dia: DiaISO, hh: number, mm = 0) =>
    new Date(inicioDia(dia, TZ).getTime() + (hh * 60 + mm) * 60_000);
  const esDomingo = (dia: DiaISO) => new Date(`${dia}T12:00:00Z`).getUTCDay() === 0;
  const hace = (dias: number) => sumarDias(hoy, -dias);
  /** Nunca en el futuro: lo que caería después de ahora se corre a unos minutos antes. */
  const momento = (dia: DiaISO, hh: number, mm = 0) => {
    const m = en(dia, hh, mm);
    return m < ahoraReal ? m : new Date(ahoraReal.getTime() - entre(5, 90) * 60_000);
  };

  // --- Catálogo, clientes y proveedores (existen desde antes del primer día) ---
  fijarReloj(() => en(sumarDias(primerDia, -1), 10));
  for (const nombre of cfg.categorias) {
    await db.categoria.upsert({
      where: { panelId_nombre: { panelId: cfg.panelId, nombre } },
      update: {},
      create: { nombre },
    });
  }
  for (const [pi, p] of cfg.productos.entries()) {
    const marca = await db.marca.upsert({
      where: { panelId_nombre: { panelId: cfg.panelId, nombre: p.marca } },
      update: {},
      create: { nombre: p.marca },
    });
    const categoria = p.categoria
      ? await db.categoria.findUniqueOrThrow({
          where: { panelId_nombre: { panelId: cfg.panelId, nombre: p.categoria } },
        })
      : null;
    await transaccion(
      ctxDueno,
      async (tx) => {
        const producto = await tx.producto.create({
          data: {
            marcaId: marca.id,
            nombre: p.modelo,
            especificacion: p.especificacion,
            categoriaId: categoria?.id ?? null,
            precioVenta: D(p.venta),
          },
        });
        for (const [si, s] of p.sabores.entries()) {
          const ean12 = `779${cfg.codigo}80${String(pi).padStart(3, "0")}${String(si).padStart(3, "0")}`;
          const variante = await tx.variante.create({
            data: {
              productoId: producto.id,
              nombre: s.nombre,
              sku: await generarSku(tx),
              codigoBarras: generarEan13(ean12),
              precioVenta: s.precioPropio ? D(s.precioPropio) : null,
              ultimoCosto: D(p.costo),
              stockMinimo: p.minimo,
            },
          });
          for (const [i, dep] of depositos.entries()) {
            const cantidad = s.peso === 0 && i > 0 ? 0 : (p.stock[i] ?? 0);
            if (cantidad <= 0) continue;
            await registrarMovimiento(tx, {
              tipo: TipoMovimiento.INGRESO_MANUAL,
              varianteId: variante.id,
              depositoId: dep.id,
              cantidad,
              costoUnitario: D(p.costo),
              motivo: "Stock inicial (demo)",
              usuarioId: ctxDueno.usuarioId,
            });
          }
        }
      },
      { timeout: 60_000 },
    );
  }

  const productoPorNombre = new Map(
    (await db.producto.findMany({ where: { deletedAt: null } })).map((p) => [p.nombreCompleto, p]),
  );
  const proveedorPorNombre = new Map<string, { id: string }>();
  for (const p of cfg.proveedores) {
    const telefono = normalizarTelefono(p.telefono);
    const proveedor =
      (await db.proveedor.findFirst({ where: { telefono, deletedAt: null } })) ??
      (await db.proveedor.create({
        data: {
          nombre: p.nombre,
          nombreTienda: p.nombreTienda,
          telefono,
          notas: p.notas ?? null,
        },
      }));
    proveedorPorNombre.set(p.nombre, proveedor);
    for (const pr of p.precios) {
      const producto = productoPorNombre.get(pr.producto);
      if (!producto) throw new Error(`No existe el producto ${pr.producto} en ${cfg.panelId}`);
      await asignarProducto(ctxDueno, proveedor.id, {
        productoId: producto.id,
        precio: pr.precio,
        moneda: pr.moneda ?? Moneda.ARS,
      });
    }
  }
  const proveedores = [...proveedorPorNombre.values()];

  const clientes: { id: string }[] = await db.cliente.findMany({
    where: { deletedAt: null, activo: true },
    select: { id: true },
  });
  /**
   * El alta de un cliente la fecha la base (createdAt = now()): se lleva al
   * momento simulado para que "clientes nuevos" del dashboard tenga sentido.
   */
  const fechar = async (c: { id: string }) => {
    await db.cliente.update({ where: { id: c.id }, data: { createdAt: ahora() } });
    return { id: c.id };
  };
  let altas = 0;
  const datosClienteNuevo = () => {
    altas++;
    const nombre =
      altas % 17 === 0
        ? `${elegir(KIOSCOS)} ${altas}`
        : `${NOMBRES[altas % NOMBRES.length]} ${APELLIDOS[Math.floor(altas / NOMBRES.length) % APELLIDOS.length]}`;
    const n = String(altas).padStart(4, "0");
    return { nombre, telefono: `11 6${cfg.codigo}${n.slice(0, 2)}-${n}` };
  };
  // Un poco más de la mitad son clientes de antes; el resto se da de alta al vender.
  const iniciales = Math.round(cfg.clientes * 0.55);
  /** Probabilidad de que una venta traiga un cliente nuevo (reparte las altas en los 90 días). */
  const probNuevo = ((cfg.clientes - iniciales) / cfg.ventas) * 1.1;
  while (clientes.length < iniciales) {
    clientes.push(
      await fechar(await crearCliente(ctxDueno, crearClienteSchema.parse(datosClienteNuevo()))),
    );
  }

  const variantes: VarianteDemo[] = (
    await db.variante.findMany({
      where: { deletedAt: null, activo: true },
      include: { producto: { select: { nombreCompleto: true } } },
      orderBy: { createdAt: "asc" },
    })
  ).map((v) => {
    const demo = cfg.productos
      .find(
        (p) =>
          [p.marca, p.modelo, p.especificacion].filter(Boolean).join(" ") ===
          v.producto.nombreCompleto,
      )
      ?.sabores.find((s) => s.nombre === v.nombre);
    return {
      id: v.id,
      productoId: v.productoId,
      producto: v.producto.nombreCompleto,
      // Los del seed base: los vapes se venden más que los accesorios.
      peso: demo?.peso ?? (v.producto.nombreCompleto.startsWith("TechPro") ? 1 : 4),
    };
  });
  const vendibles = variantes.filter((v) => v.peso > 0);

  const stockEn = async (varianteId: string, depositoId: string) =>
    (
      await db.stock.findUnique({
        where: {
          panelId_varianteId_depositoId: { panelId: cfg.panelId, varianteId, depositoId },
        },
      })
    )?.cantidad ?? 0;

  const stats = {
    ventas: 0,
    mayoristas: 0,
    anuladas: 0,
    compras: 0,
    garantias: 0,
    cotizaciones: 0,
    convertidas: 0,
    ajustes: 0,
    transferencias: 0,
    cambiosPrecio: 0,
  };
  const recientes: { venta: VentaGenerada; depositoId: string }[] = [];

  // --- Ventas ---------------------------------------------------------------
  async function lineasConStock(depositoId: string, n: number, cantidades: () => number) {
    const lineas = new Map<string, number>();
    for (let i = 0; i < n * 3 && lineas.size < n; i++) {
      const v = ponderado(vendibles.map((x) => ({ valor: x, peso: x.peso })));
      if (lineas.has(v.id)) continue;
      const cant = Math.min(cantidades(), await stockEn(v.id, depositoId));
      if (cant > 0) lineas.set(v.id, cant);
    }
    return lineas;
  }

  /** Líneas mayoristas: varios sabores de un mismo producto, 10–40 unidades en total. */
  async function lineasMayoristas(depositoId: string) {
    const porProducto = new Map<string, VarianteDemo[]>();
    for (const v of vendibles)
      porProducto.set(v.productoId, [...(porProducto.get(v.productoId) ?? []), v]);
    const candidatos = mezclar([...porProducto.values()]);
    for (const grupo of candidatos) {
      const lineas = new Map<string, number>();
      let objetivo = entre(10, 40);
      for (const v of mezclar(grupo).slice(0, 3)) {
        const cant = Math.min(Math.ceil(objetivo / 2), (await stockEn(v.id, depositoId)) - 2);
        if (cant >= 3) {
          lineas.set(v.id, cant);
          objetivo -= cant;
        }
        if (objetivo <= 0) break;
      }
      const total = [...lineas.values()].reduce((a, b) => a + b, 0);
      if (total >= 10) return lineas;
    }
    return new Map<string, number>();
  }

  async function unaVenta(opciones: { soloUnitaria?: boolean } = {}): Promise<boolean> {
    const vendedor = ponderado(vendedores);
    const dueno = esDueno(vendedor);
    const deposito = depositos.length > 1 && azar() < 0.35 ? depositos[1]! : principal;
    const mayorista = !opciones.soloUnitaria && dueno && azar() < cfg.mayoristas;
    const lineas = mayorista
      ? await lineasMayoristas(deposito.id)
      : await lineasConStock(
          deposito.id,
          ponderado([
            { valor: 1, peso: 6 },
            { valor: 2, peso: 3 },
            { valor: 3, peso: 1 },
          ]),
          () =>
            ponderado([
              { valor: 1, peso: 7 },
              { valor: 2, peso: 2 },
              { valor: 3, peso: 1 },
            ]),
        );
    if (lineas.size === 0) return false;
    const ctx = ctxDe(vendedor);

    let items: { varianteId: string; cantidad: number; precioEspecial?: string }[] = [
      ...lineas,
    ].map(([varianteId, cantidad]) => ({ varianteId, cantidad }));
    if (mayorista) {
      // Precio por escalón (el mismo que calcula el cotizador).
      const precios = await calcularPrecios(
        ctx,
        { tipo: "MAYORISTA", items: items.map((i) => ({ ...i })) },
        { puedeEditar: true },
      );
      items = precios.items.map((i) => ({
        varianteId: i.varianteId,
        cantidad: i.cantidad,
        precioEspecial: i.precioUnitario !== i.precioLista ? i.precioUnitario : undefined,
      }));
    }

    const cupoNuevos = clientes.length < cfg.clientes - 2;
    const cliente =
      cupoNuevos && azar() < probNuevo
        ? { nuevo: datosClienteNuevo() }
        : { id: elegir(clientes).id };
    const medioPago = ponderado(MEDIOS);
    const datos = generarVentaSchema.parse({
      depositoId: deposito.id,
      cliente,
      items,
      medioPago,
      tipo: mayorista ? "MAYORISTA" : "UNITARIA",
      // En efectivo, a veces el dueño redondea a favor del cliente.
      descuento:
        dueno && !mayorista && medioPago === MedioPago.EFECTIVO && azar() < 0.2
          ? "500.00"
          : undefined,
    });
    try {
      const v = await generarVenta(ctx, datos, { puedeEditar: dueno });
      stats.ventas++;
      if (mayorista) stats.mayoristas++;
      if (v.clienteNuevo) clientes.push(await fechar(v.cliente));
      recientes.push({ venta: v, depositoId: deposito.id });
      if (recientes.length > 30) recientes.shift();
      // ~2%: se anula en el momento (error de carga); la mercadería vuelve al galpón.
      if (azar() < 0.02) {
        await anularVenta(ctxDueno, v.id, "Error de carga: se cobró dos veces");
        recientes.pop();
        stats.anuladas++;
      }
      return true;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      return false;
    }
  }

  // --- Garantías: se entrega una unidad nueva del mismo sabor -----------------
  async function unaGarantia(anular: boolean) {
    for (const r of [...recientes].reverse()) {
      const item = r.venta.items[0];
      if (!item || (await stockEn(item.varianteId, r.depositoId)) < 1) continue;
      const quien = ponderado(vendedores);
      const d = await registrarDevolucion(
        ctxDe(esDueno(quien) ? quien : dueno),
        registrarDevolucionSchema.parse({
          clienteId: r.venta.cliente.id,
          ventaId: r.venta.id,
          depositoId: r.depositoId,
          items: [{ varianteId: item.varianteId, cantidad: 1 }],
          observacion: elegir(FALLAS),
        }),
      );
      recientes.splice(recientes.indexOf(r), 1);
      stats.garantias++;
      if (anular) await anularDevolucion(ctxDueno, d.id, "Se registró por error");
      return;
    }
  }

  // --- Compras: reponer lo que está bajo --------------------------------------
  async function unaCompra(depositoId: string, recibir: boolean) {
    const objetivo = depositoId === principal.id ? 40 : 20;
    const stocks = await Promise.all(
      vendibles.map(async (v) => ({ v, s: await stockEn(v.id, depositoId) })),
    );
    let reponer = stocks.filter((x) => x.s < objetivo * 0.5);
    if (reponer.length === 0) reponer = stocks.sort((a, b) => a.s - b.s).slice(0, 3);
    reponer = reponer.slice(0, 14);
    const proveedor = elegir(proveedores);
    const listaProveedor = await db.proveedorProducto.findMany({
      where: { proveedorId: proveedor.id, moneda: Moneda.ARS },
    });
    const items = [];
    for (const { v, s } of reponer) {
      const deLista = listaProveedor.find((p) => p.productoId === v.productoId)?.precio;
      const { ultimoCosto } = await db.variante.findUniqueOrThrow({ where: { id: v.id } });
      const costo = deLista ?? ultimoCosto ?? D(9000);
      // A veces el proveedor cobra un poco más que su lista (se actualiza al recibir).
      const ajuste = azar() < 0.25 ? 1.03 : 1;
      items.push({
        varianteId: v.id,
        cantidad: Math.max(objetivo - s, 6),
        costoUnitario: Number(D(costo).mul(ajuste).toFixed(0)),
      });
    }
    const c = await crearCompra(ctxDueno, {
      proveedorId: proveedor.id,
      depositoId,
      fecha: ahora(),
      items,
      notas: recibir ? undefined : "Pedido a confirmar",
    });
    if (!recibir) return;
    // Recibir actualiza el último costo de cada sabor; a veces también la
    // lista de precios del proveedor (queda en su historial).
    await recibirCompra(ctxDueno, c.id, { actualizarPrecioProveedor: azar() < 0.4 });
    stats.compras++;
  }

  // --- Cotizaciones ------------------------------------------------------------
  const DUENO = { puedeEditar: true };
  async function itemsCotizacion(mayorista: boolean) {
    const lineas = mayorista
      ? await lineasMayoristas(principal.id)
      : await lineasConStock(principal.id, 2, () => entre(1, 3));
    return [...lineas].map(([varianteId, cantidad]) => ({ varianteId, cantidad }));
  }

  async function unaCotizacion(
    plan: PanelDemo["cotizaciones"][number],
    indice: number,
    dia: DiaISO,
  ) {
    const autor = ponderado(vendedores);
    const ctx = ctxDe(autor);
    const items = await itemsCotizacion(plan.mayorista);
    if (items.length === 0) return;
    const nuevo = indice % 6 === 5;
    const c = await crearCotizacion(
      ctx,
      {
        tipo: plan.mayorista ? "MAYORISTA" : "UNITARIA",
        items,
        cliente: nuevo ? datosClienteNuevo() : { id: elegir(clientes).id },
        notas: plan.mayorista ? "Pedido para reventa" : undefined,
      },
      esDueno(autor) ? DUENO : { puedeEditar: false },
    );
    stats.cotizaciones++;
    if (plan.estado === "BORRADOR") return;
    await marcarEnviada(ctx, c.id);
    if (plan.estado === "ENVIADA" || plan.estado === "VENCIDA") return;
    if (plan.estado === "RECHAZADA") {
      fijarReloj(() => momento(sumarDias(dia, 1), 12, entre(0, 59)));
      await marcarRechazada(ctx, c.id, elegir(["Le pareció caro", "Consiguió en otro lado", ""]));
      return;
    }
    if (plan.estado === "ACEPTADA") {
      await marcarAceptada(ctx, c.id);
      return;
    }
    // CONVERTIDA: un rato después, cuando el cliente confirma.
    fijarReloj(() => momento(dia, 15, entre(0, 59)));
    try {
      const v = await convertirEnVenta(ctx, c.id, {
        depositoId: principal.id,
        medioPago: ponderado(MEDIOS),
      });
      if (nuevo) clientes.push(await fechar(v.cliente));
      stats.convertidas++;
      stats.ventas++;
      if (v.tipo === "MAYORISTA") stats.mayoristas++;
      recientes.push({ venta: v, depositoId: principal.id });
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }

  // --- Agenda del período ------------------------------------------------------
  const eventos: Evento[] = [];
  let secuencia = 0;
  const agendar = (m: Date, hacer: () => Promise<void>, orden = 5) => {
    if (m > ahoraReal) return;
    eventos.push({ momento: m, orden: orden * 100_000 + secuencia++, hacer });
  };
  const dias = Array.from({ length: DIAS }, (_, i) => sumarDias(primerDia, i));
  const horaActual = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(
      ahoraReal,
    ),
  );
  // Días de venta: cerrado los domingos; viernes y sábados, más movimiento.
  const pesoDia = dias.map((dia) => {
    if (dia === hoy) return horaActual >= 11 ? 1 : 0;
    if (esDomingo(dia)) return 0;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    return dow === 5 || dow === 6 ? 1.7 : 1;
  });
  const convertidas = cfg.cotizaciones.filter((c) => c.estado === "CONVERTIDA").length;
  const ventasSimples = cfg.ventas - convertidas;
  for (let k = 0; k < ventasSimples; k++) {
    const dia = ponderado(dias.map((d, i) => ({ valor: d, peso: pesoDia[i]! })));
    const tope = dia === hoy ? Math.max(10, horaActual - 1) : 20;
    const hh = Math.min(
      tope,
      ponderado([
        { valor: entre(10, 12), peso: 3 },
        { valor: entre(13, 16), peso: 3 },
        { valor: entre(17, 20), peso: 5 },
      ]),
    );
    agendar(momento(dia, hh, entre(0, 59)), async () => {
      for (let intento = 0; intento < 4; intento++) if (await unaVenta()) return;
    });
  }
  // Compras recibidas, repartidas en el período (2 de cada 3 al galpón principal).
  for (let k = 0; k < cfg.compras; k++) {
    const dia = dias[Math.min(DIAS - 1, 1 + Math.floor((k * (DIAS - 3)) / cfg.compras))]!;
    const dep = depositos.length > 1 && k % 3 === 2 ? depositos[1]! : principal;
    agendar(en(dia, 9, 30), () => unaCompra(dep.id, true), 1);
  }
  // Garantías (la tercera se anula: se registró por error).
  for (let k = 0; k < cfg.garantias; k++) {
    const dia = dias[Math.min(DIAS - 1, 6 + Math.floor((k * (DIAS - 8)) / cfg.garantias))]!;
    agendar(momento(dia, 18, 15), () => unaGarantia(k === 2), 6);
  }
  // Cotizaciones según el plan.
  cfg.cotizaciones.forEach((plan, i) => {
    const dia = hace(plan.haceDias);
    agendar(momento(dia, 11, entre(0, 59)), () => unaCotizacion(plan, i, dia), 4);
  });
  // Cambios de precio de los proveedores (historial).
  for (const cambio of cfg.cambiosPrecio) {
    agendar(en(hace(cambio.haceDias), 8, 30), async () => {
      await asignarProducto(ctxDueno, proveedorPorNombre.get(cambio.proveedor)!.id, {
        productoId: productoPorNombre.get(cambio.producto)!.id,
        precio: cambio.precio,
        moneda: cambio.moneda ?? Moneda.ARS,
      });
      stats.cambiosPrecio++;
    });
  }
  // Ajustes de inventario: roturas, faltantes y alguno que aparece en el recuento.
  for (let k = 0; k < cfg.ajustes; k++) {
    const dia = dias[15 + k * 17]!;
    agendar(momento(dia, 20, 30), async () => {
      const v = elegir(vendibles);
      const dep = depositos[k % depositos.length]!;
      const s = await stockEn(v.id, dep.id);
      if (s < 3) return;
      const aparecio = k === 2;
      await registrarAjuste(ctxDe(duena), {
        depositoId: dep.id,
        varianteId: v.id,
        cantidadReal: aparecio ? s + 1 : s - entre(1, 2),
        motivo: aparecio ? "Apareció en el recuento" : "Faltante en recuento semanal",
      });
      stats.ajustes++;
    });
  }
  // Transferencias: una completada hace dos meses y una pendiente de hace 3 días.
  if (cfg.transferencias && depositos.length > 1) {
    for (const haceDias of [60, 3]) {
      agendar(
        en(hace(haceDias), 9, 45),
        async () => {
          const conStock = [];
          for (const v of vendibles.slice(0, 12)) {
            if ((await stockEn(v.id, principal.id)) >= 10) conStock.push(v);
          }
          if (conStock.length === 0) return;
          const t = await crearTransferencia(ctxDueno, {
            depositoOrigenId: principal.id,
            depositoDestinoId: depositos[1]!.id,
            fecha: ahora(),
            notas: `Reposición ${depositos[1]!.nombre}`,
            items: conStock.slice(0, 3).map((v) => ({ varianteId: v.id, cantidad: 4 })),
          });
          if (haceDias > 30) await completarTransferencia(ctxDe(duena), t.id);
          stats.transferencias++;
        },
        2,
      );
    }
  }

  eventos.sort((a, b) => a.momento.getTime() - b.momento.getTime() || a.orden - b.orden);
  for (const ev of eventos) {
    fijarReloj(() => ev.momento);
    await ev.hacer();
  }

  // Si alguna venta no se pudo hacer (sin stock en ese momento), se completa
  // en las últimas horas para llegar al total pedido.
  let faltantes = 0;
  while (stats.ventas < cfg.ventas && faltantes < 200) {
    faltantes++;
    fijarReloj(() => new Date(ahoraReal.getTime() - entre(30, 600) * 60_000));
    await unaVenta({ soloUnitaria: true });
  }
  // Clientes que todavía no compraron (completa el total pedido).
  fijarReloj(() => en(hace(1), 19));
  while (clientes.length < cfg.clientes) {
    clientes.push(
      await fechar(await crearCliente(ctxDueno, crearClienteSchema.parse(datosClienteNuevo()))),
    );
  }
  // Un pedido sin recibir (para el listado de compras).
  if (cfg.compras > 5) {
    fijarReloj(() => new Date(ahoraReal.getTime() - 20 * 60_000));
    await unaCompra(principal.id, false);
  }
  fijarReloj(null);
  // Pasa a VENCIDA las cotizaciones que ya no valen.
  await listarCotizaciones(ctxDueno, {});

  const [ventas, total, cantidadClientes] = await Promise.all([
    db.venta.groupBy({ by: ["estado"], _count: true }),
    db.venta.aggregate({ where: { estado: "CONFIRMADA" }, _sum: { total: true } }),
    db.cliente.count({ where: { deletedAt: null } }),
  ]);
  console.log(`seed-demo OK (${cfg.panelId})`, {
    ...stats,
    clientes: cantidadClientes,
    ventasPorEstado: Object.fromEntries(ventas.map((v) => [v.estado, v._count])),
    facturado: (total._sum.total ?? D(0)).toString(),
    desde: primerDia,
    hasta: hoy,
  });
}

async function main() {
  const marcador = await dbPara(VAPES.panelId).producto.findFirst({
    where: { nombreCompleto: "Lost Mary MO 5000" },
  });
  if (marcador) {
    console.log(
      "seed-demo ya se corrió en esta base (el catálogo demo existe en Vapes): no hago nada.",
    );
    return;
  }
  const inicio = Date.now();
  const ahoraReal = new Date();

  // Comisión orientativa de Trinidad (la ve el dueño en el rendimiento del equipo).
  await prisma.usuario.updateMany({
    where: { nombre: "Trinidad", rol: RolUsuario.EMPLEADO },
    data: { comisionUnitariaPct: D(5), comisionMayoristaPct: D(3) },
  });
  // Cotización del dólar de Vapes (precios de proveedores en USD → pesos).
  await dbPara(VAPES.panelId).configuracion.upsert({
    where: { panelId_clave: { panelId: VAPES.panelId, clave: "cotizacionUsd" } },
    update: { valor: COTIZACION_USD },
    create: { clave: "cotizacionUsd", valor: COTIZACION_USD },
  });

  for (const panel of [VAPES, COSMETIC, ESPECIALES]) await simularPanel(panel, ahoraReal);
  console.log(`seed-demo terminado en ${Math.round((Date.now() - inicio) / 1000)} s`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    fijarReloj(null);
    return prisma.$disconnect();
  });
