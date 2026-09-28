/**
 * SEED DEMO — 90 días de operación simulada del panel Vapes (ventas, compras,
 * transferencias, ajustes, clientes y devoluciones por garantía) para probar
 * el dashboard y los listados.
 * Separado del seed base (que sigue siendo el mínimo para arrancar). Los
 * paneles Cosmetic y Especiales no se tocan.
 *
 * La operación no inserta filas "a mano": fija el reloj de negocio
 * (src/lib/reloj.ts) en cada momento simulado y llama a los MISMOS servicios
 * que la app (generarVenta, anularVenta, compras, transferencias, ajustes,
 * registrarDevolucion) con
 * `ctx = { panelId: Vapes, usuarioId }`. Así los triggers, la numeración por
 * panel, el último costo de cada sabor y el ledger se ejercitan de verdad.
 * El catálogo extra y los proveedores demo se crean con el cliente del panel.
 *
 * Uso (sobre una DB con el seed base): pnpm db:seed-demo
 * Si la demo ya está cargada (existe su catálogo en Vapes), no hace nada.
 * Determinístico: PRNG con semilla fija.
 */
import { MedioPago, Modulo, Moneda, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { normalizarPermiso } from "../src/lib/permisos";
import { ahora, fijarReloj } from "../src/lib/reloj";
import { crearClienteSchema, normalizarTelefono } from "../src/lib/validations/cliente";
import { registrarDevolucionSchema } from "../src/lib/validations/devolucion";
import { generarVentaSchema } from "../src/lib/validations/venta";
import { diaEn, inicioDia, sumarDias, type DiaISO } from "../src/lib/zona-horaria";
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
import { zonaHorariaNegocio } from "../src/server/services/dashboard.service";
import { anularDevolucion, registrarDevolucion } from "../src/server/services/devolucion.service";
import {
  completarTransferencia,
  crearTransferencia,
  registrarAjuste,
} from "../src/server/services/movimiento.service";
import { generarSku } from "../src/server/services/producto.service";
import { registrarMovimiento } from "../src/server/services/stock.service";
import {
  anularVenta,
  generarVenta,
  type VentaGenerada,
} from "../src/server/services/venta.service";

/**
 * En producción el seed NO corre (crea usuarios con contraseñas conocidas):
 * solo con ALLOW_SEED=true. El primer dueño se crea con `pnpm crear-owner`.
 */
if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "true") {
  console.error(
    "✘ seed demo bloqueado en producción (definí ALLOW_SEED=true si de verdad es una base de prueba).",
  );
  process.exit(1);
}

const PANEL = "pnl_vapes";
const db = dbPara(PANEL);
const DIAS = 90;
const META = { ip: "127.0.0.1", userAgent: "seed-demo" };
const ctxDe = (u: { id: string }): Ctx => ({ panelId: PANEL, usuarioId: u.id, meta: META });

// -----------------------------------------------------------------------------
// PRNG determinístico (mulberry32)
// -----------------------------------------------------------------------------
let semilla = 20260925;
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

// -----------------------------------------------------------------------------
// Catálogo extra (con un sabor que nunca se vende: "sabor muerto")
// -----------------------------------------------------------------------------
interface ProductoDemo {
  marca: string;
  modelo: string;
  /** Pitadas (o lo que corresponda); "" si no aplica. */
  especificacion: string;
  /** El nombre completo que arma la DB (marca + modelo + especificación). */
  nombreCompleto: string;
  categoria: string;
  costo: string;
  /** Precio de todos los sabores (salvo los que tienen `precioPropio`). */
  venta: string;
  minimo: number;
  /** stock: [Ayres Plaza, Mercedes]. */
  sabores: {
    nombre: string;
    ean12: string;
    peso: number;
    stock: [number, number];
    precioPropio?: string;
  }[];
}

const PRODUCTOS_DEMO: ProductoDemo[] = [
  {
    marca: "Lost Mary",
    modelo: "MO",
    especificacion: "5000",
    nombreCompleto: "Lost Mary MO 5000",
    categoria: "Vapes",
    costo: "8800.00",
    venta: "15500.00",
    minimo: 8,
    sabores: [
      {
        nombre: "Blue Razz",
        ean12: "779000400001",
        peso: 9,
        stock: [20, 10],
        precioPropio: "16000.00",
      },
      { nombre: "Watermelon", ean12: "779000400002", peso: 7, stock: [18, 8] },
      { nombre: "Grape", ean12: "779000400003", peso: 4, stock: [12, 6] },
      { nombre: "Peach Ice", ean12: "779000400004", peso: 3, stock: [10, 4] },
      // Nunca se vende: queda como producto sin movimiento.
      { nombre: "Café Tabaco", ean12: "779000400005", peso: 0, stock: [15, 0] },
    ],
  },
  {
    marca: "Nasty Juice",
    modelo: "Salt",
    especificacion: "30ml",
    nombreCompleto: "Nasty Juice Salt 30ml",
    categoria: "Líquidos",
    costo: "5200.00",
    venta: "9500.00",
    minimo: 5,
    sabores: [
      { nombre: "Bad Blood", ean12: "779000500001", peso: 3, stock: [10, 5] },
      { nombre: "Cushman", ean12: "779000500002", peso: 2, stock: [8, 4] },
      { nombre: "Slow Blow", ean12: "779000500003", peso: 1, stock: [6, 0] },
    ],
  },
  {
    marca: "Vaporesso",
    modelo: "XROS 3",
    especificacion: "",
    nombreCompleto: "Vaporesso XROS 3",
    categoria: "Pods",
    costo: "18000.00",
    venta: "32000.00",
    minimo: 2,
    sabores: [{ nombre: "Único", ean12: "779000600001", peso: 1, stock: [5, 2] }],
  },
];

/** Popularidad de las variantes del seed base. */
const PESOS_BASE: Record<string, number> = {
  "Ignite V80 8000|Mango Ice": 10,
  "Ignite V80 8000|Strawberry Watermelon": 7,
  "Ignite V80 8000|Blue Razz Ice": 8,
  "Ignite V80 8000|Grape Ice": 4,
  "Elf Bar BC 5000|Watermelon Ice": 7,
  "Elf Bar BC 5000|Peach Mango": 5,
  "Elf Bar BC 5000|Cool Mint": 4,
  "Elf Bar BC 5000|Lemon Mint": 2,
  "Elf Bar BC 10000|Watermelon Ice": 3,
  "Elf Bar BC 10000|Blue Razz Ice": 2,
  "TechPro Cargador USB-C 20W|Único": 3,
  "TechPro Parlante Bluetooth Mini|Único": 1,
};

/** Costo de reposición si un sabor todavía no tiene último costo. */
const COSTO_POR_DEFECTO = 9000;

interface VarianteDemo {
  id: string;
  productoId: string;
  /** "Nombre completo|Sabor". */
  nombre: string;
  peso: number;
}

async function crearCatalogoDemo(ctx: Ctx, g1: string, g2: string) {
  for (const p of PRODUCTOS_DEMO) {
    const categoria = await db.categoria.findUniqueOrThrow({
      where: { panelId_nombre: { panelId: PANEL, nombre: p.categoria } },
    });
    const marca = await db.marca.upsert({
      where: { panelId_nombre: { panelId: PANEL, nombre: p.marca } },
      update: {},
      create: { nombre: p.marca },
    });
    await transaccion(
      ctx,
      async (tx) => {
        const producto = await tx.producto.create({
          data: {
            marcaId: marca.id,
            nombre: p.modelo,
            especificacion: p.especificacion,
            categoriaId: categoria.id,
            precioVenta: p.venta,
          },
        });
        for (const s of p.sabores) {
          const variante = await tx.variante.create({
            data: {
              productoId: producto.id,
              nombre: s.nombre,
              sku: await generarSku(tx),
              codigoBarras: generarEan13(s.ean12),
              precioVenta: s.precioPropio ?? null,
              ultimoCosto: p.costo,
              stockMinimo: p.minimo,
            },
          });
          for (const [i, dep] of [g1, g2].entries()) {
            const cantidad = s.stock[i] ?? 0;
            if (cantidad > 0) {
              await registrarMovimiento(tx, {
                tipo: TipoMovimiento.INGRESO_MANUAL,
                varianteId: variante.id,
                depositoId: dep,
                cantidad,
                costoUnitario: p.costo,
                motivo: "Stock inicial (demo)",
                usuarioId: ctx.usuarioId,
              });
            }
          }
        }
      },
      { timeout: 60_000 },
    );
  }
}

/** Empleados demo: acceso SOLO a Vapes, con permisos de vendedor. */
async function crearUsuariosDemo() {
  const passwordHash = await bcrypt.hash("Cambiar123!", 12);
  const vendedores = [];
  for (const u of [
    { email: "ana@negocio.com", nombre: "Ana" },
    { email: "lucas@negocio.com", nombre: "Lucas" },
  ]) {
    const usuario = await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, rol: RolUsuario.EMPLEADO, passwordHash, debeCambiarPassword: true },
    });
    await prisma.usuarioPanel.upsert({
      where: { usuarioId_panelId: { usuarioId: usuario.id, panelId: PANEL } },
      update: {},
      create: { usuarioId: usuario.id, panelId: PANEL },
    });
    for (const [modulo, crear] of [
      [Modulo.DASHBOARD, false],
      [Modulo.VENTAS, true],
      [Modulo.STOCK, true],
      [Modulo.PRODUCTOS, false],
      [Modulo.CLIENTES, true],
      [Modulo.DEVOLUCIONES, true],
      [Modulo.COTIZADOR, false],
    ] as const) {
      const { panelId, ...acciones } = normalizarPermiso({
        panelId: PANEL,
        modulo,
        puedeVer: true,
        puedeCrear: crear,
        puedeEditar: false,
        puedeEliminar: false,
      });
      await prisma.permisoUsuario.upsert({
        where: { usuarioId_panelId_modulo: { usuarioId: usuario.id, panelId, modulo } },
        update: {},
        create: { usuarioId: usuario.id, panelId, ...acciones },
      });
    }
    vendedores.push(usuario);
  }
  return vendedores;
}

/** Clientes habituales: teléfonos distintos entre sí y de los del seed base (+54115555010x). */
const CLIENTES_DEMO = [
  { nombre: "Sofía Ramírez", telefono: "11 5555-0201" },
  { nombre: "Julián Pereyra", telefono: "11 5555-0202" },
  { nombre: "Camila Torres", telefono: "11 5555-0203" },
  { nombre: "Kiosco El Paso", telefono: "0351 455-0204", notas: "Compra por mayor." },
  { nombre: "Matías Luna", telefono: "+54 9 11 5555-0205" },
  { nombre: "Valentina Sosa", telefono: "11 5555-0206" },
];

/** Nombres para los clientes que se dan de alta en el momento de la venta. */
const NOMBRES = ["Agustín", "Florencia", "Tomás", "Micaela", "Bruno", "Rocío", "Joaquín", "Paula"];
const APELLIDOS = ["Benítez", "Castro", "Medina", "Rojas", "Acosta", "Molina", "Suárez", "Ríos"];

/** Proveedores demo, con su lista de precios por producto (nombre completo). */
const PROVEEDORES_DEMO = [
  {
    nombre: "Martina Vega",
    nombreTienda: "Importadora Vapor Sur",
    telefono: "11 4444-0001",
    precios: [
      { producto: "Lost Mary MO 5000", precio: "8800.00", moneda: Moneda.ARS },
      { producto: "Nasty Juice Salt 30ml", precio: "5200.00", moneda: Moneda.ARS },
      { producto: "Ignite V80 8000", precio: "9600.00", moneda: Moneda.ARS },
    ],
  },
  {
    nombre: "Diego Paz",
    nombreTienda: "TechPro Mayorista",
    telefono: "11 4444-0002",
    notas: "Accesorios y pods",
    precios: [
      { producto: "Vaporesso XROS 3", precio: "15.00", moneda: Moneda.USD },
      { producto: "TechPro Cargador USB-C 20W", precio: "4300.00", moneda: Moneda.ARS },
    ],
  },
];

const MEDIOS = [
  { valor: MedioPago.EFECTIVO, peso: 55 },
  { valor: MedioPago.TRANSFERENCIA, peso: 35 },
  { valor: MedioPago.BINANCE, peso: 10 },
] as const;

/** Fallas típicas que se cambian por garantía (observación ≥ 10 caracteres). */
const FALLAS = [
  "No enciende: la luz titila y no tira (demo).",
  "Vino con pérdida de líquido en la caja (demo).",
  "No carga con el cable original (demo).",
  "Sabor a quemado desde la primera pitada (demo).",
];

// -----------------------------------------------------------------------------
// Simulación
// -----------------------------------------------------------------------------

type Evento = { momento: Date; orden: number; hacer: () => Promise<void> };

async function main() {
  if (
    await db.producto.findFirst({ where: { nombreCompleto: PRODUCTOS_DEMO[0]!.nombreCompleto } })
  ) {
    console.log(
      "seed-demo ya se corrió en esta base (el catálogo demo existe en Vapes): no hago nada.",
    );
    return;
  }

  const [owner, owner2] = await prisma.usuario.findMany({
    where: { rol: RolUsuario.OWNER, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const g1 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Ayres Plaza" } },
  });
  const g2 = await db.deposito.findUnique({
    where: { panelId_nombre: { panelId: PANEL, nombre: "Mercedes" } },
  });
  if (!owner || !owner2 || !g1 || !g2)
    throw new Error("Corré primero el seed base (pnpm db:seed).");
  // Empleados del seed base con acceso a Vapes (Trinidad) también venden.
  const empleadosBase = await prisma.usuario.findMany({
    where: { rol: RolUsuario.EMPLEADO, deletedAt: null, paneles: { some: { panelId: PANEL } } },
    orderBy: { createdAt: "asc" },
    take: 1,
  });

  const ctxOwner = ctxDe(owner);
  const tz = await zonaHorariaNegocio(ctxOwner);
  const ahoraReal = new Date();
  const hoy = diaEn(ahoraReal, tz);
  const primerDia = sumarDias(hoy, -(DIAS - 1));
  const en = (dia: DiaISO, hh: number, mm = 0) =>
    new Date(inicioDia(dia, tz).getTime() + (hh * 60 + mm) * 60_000);

  // El catálogo, los clientes y el stock inicial "existen" desde antes del primer día.
  fijarReloj(() => en(sumarDias(primerDia, -1), 10));
  await crearCatalogoDemo(ctxOwner, g1.id, g2.id);
  const [ana, lucas] = await crearUsuariosDemo();
  const clientes: { id: string }[] = await db.cliente.findMany({
    where: { deletedAt: null, activo: true },
    select: { id: true },
  });
  for (const c of CLIENTES_DEMO) {
    const datos = crearClienteSchema.parse(c);
    const existe = await db.cliente.findFirst({
      where: { telefono: normalizarTelefono(datos.telefono)!, deletedAt: null },
    });
    if (!existe) clientes.push(await crearCliente(ctxOwner, datos));
  }
  const proveedores: { id: string }[] = [
    await db.proveedor.findFirstOrThrow({ where: { deletedAt: null } }),
  ];
  for (const p of PROVEEDORES_DEMO) {
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
    for (const pr of p.precios) {
      const producto = await db.producto.findFirstOrThrow({
        where: { nombreCompleto: pr.producto, deletedAt: null },
        select: { id: true },
      });
      await db.proveedorProducto.upsert({
        where: {
          panelId_proveedorId_productoId: {
            panelId: PANEL,
            proveedorId: proveedor.id,
            productoId: producto.id,
          },
        },
        update: {},
        create: {
          proveedorId: proveedor.id,
          productoId: producto.id,
          precio: pr.precio,
          moneda: pr.moneda,
          usuarioId: owner.id,
        },
      });
    }
    proveedores.push(proveedor);
  }

  const variantes: VarianteDemo[] = (
    await db.variante.findMany({
      where: { deletedAt: null },
      include: { producto: { select: { id: true, nombreCompleto: true } } },
    })
  ).map((v) => {
    const clave = `${v.producto.nombreCompleto}|${v.nombre}`;
    const demo = PRODUCTOS_DEMO.find(
      (p) => p.nombreCompleto === v.producto.nombreCompleto,
    )?.sabores.find((s) => s.nombre === v.nombre);
    return {
      id: v.id,
      productoId: v.producto.id,
      nombre: clave,
      peso: demo?.peso ?? PESOS_BASE[clave] ?? 1,
    };
  });
  const vendibles = variantes.filter((v) => v.peso > 0);

  const cajeros: Record<string, { id: string }[]> = {
    [g1.id]: [owner, ana!, ...empleadosBase],
    [g2.id]: [lucas!, owner2],
  };

  const stats = {
    ventas: 0,
    anuladas: 0,
    clientesNuevos: 0,
    devoluciones: 0,
    compras: 0,
    transferencias: 0,
    ajustes: 0,
    fallidas: 0,
  };
  /** Ventas recientes (para vincular devoluciones por garantía). */
  const recientes: { venta: VentaGenerada; depositoId: string }[] = [];
  let altas = 0;
  const agenda = new Map<DiaISO, Evento[]>();
  const esDomingo = (dia: DiaISO) => new Date(`${dia}T12:00:00Z`).getUTCDay() === 0;
  const agendar = (dia: DiaISO, momento: Date, hacer: () => Promise<void>, orden = 5) => {
    // Los domingos está cerrado: lo que caía ese día pasa al lunes.
    if (esDomingo(dia) && dia !== hoy) {
      dia = sumarDias(dia, 1);
      momento = new Date(momento.getTime() + 24 * 3600_000);
    }
    if (dia > hoy || momento > ahoraReal) return;
    const lista = agenda.get(dia) ?? [];
    lista.push({ momento, orden, hacer });
    agenda.set(dia, lista);
  };
  const stockEn = async (varianteId: string, depositoId: string) =>
    (
      await db.stock.findUnique({
        where: { panelId_varianteId_depositoId: { panelId: PANEL, varianteId, depositoId } },
      })
    )?.cantidad ?? 0;

  // --- Ventas: se cobran completas en el momento con un único medio de pago ------
  async function unaVenta(depositoId: string) {
    const cajero = elegir(cajeros[depositoId]!);
    const lineas = new Map<string, number>();
    const n = ponderado([
      { valor: 1, peso: 6 },
      { valor: 2, peso: 3 },
      { valor: 3, peso: 1 },
    ]);
    for (let i = 0; i < n; i++) {
      const v = ponderado(vendibles.map((x) => ({ valor: x, peso: x.peso })));
      const cant = ponderado([
        { valor: 1, peso: 7 },
        { valor: 2, peso: 2 },
        { valor: 3, peso: 1 },
      ]);
      const disponible = (await stockEn(v.id, depositoId)) - (lineas.get(v.id) ?? 0);
      if (disponible >= cant) lineas.set(v.id, (lineas.get(v.id) ?? 0) + cant);
    }
    if (lineas.size === 0) return;
    const medioPago = ponderado(MEDIOS);
    const esDueno = cajero.id === owner!.id || cajero.id === owner2!.id;
    const mayorista = azar() < 0.08;
    // 65%: cliente habitual; el resto se da de alta en la misma venta (nombre + teléfono).
    let cliente: { id: string } | { nuevo: { nombre: string; telefono: string } };
    if (azar() < 0.65) cliente = { id: elegir(clientes).id };
    else {
      altas++;
      cliente = {
        nuevo: {
          nombre: `${elegir(NOMBRES)} ${elegir(APELLIDOS)}`,
          telefono: `11 6${String(altas).padStart(3, "0")}-${String(4000 + altas).slice(-4)}`,
        },
      };
    }
    const items = [...lineas].map(([varianteId, cantidad]) => ({
      varianteId,
      cantidad: mayorista ? cantidad * 5 : cantidad,
      precioEspecial: undefined as string | undefined,
    }));
    // Mayorista: si hay stock para multiplicar, precio especial (−12%) que solo da un dueño.
    for (const it of items) {
      if (!mayorista) break;
      if ((await stockEn(it.varianteId, depositoId)) < it.cantidad) it.cantidad /= 5;
      else if (esDueno) it.precioEspecial = (await precioLista(it.varianteId)).mul(0.88).toFixed(0);
    }
    const datos = generarVentaSchema.parse({
      depositoId,
      cliente,
      items,
      medioPago,
      tipo: mayorista ? "MAYORISTA" : "UNITARIA",
      // En efectivo, a veces el dueño redondea a favor del cliente.
      descuento: esDueno && medioPago === MedioPago.EFECTIVO && azar() < 0.3 ? "500.00" : undefined,
    });
    try {
      const v = await generarVenta(ctxDe(cajero), datos, { puedeEditar: esDueno });
      stats.ventas++;
      if (v.clienteNuevo) {
        stats.clientesNuevos++;
        clientes.push({ id: v.cliente.id });
      }
      recientes.push({ venta: v, depositoId });
      if (recientes.length > 20) recientes.shift();
      // ~3%: se anula en el momento (error de carga); la mercadería vuelve al depósito.
      if (azar() < 0.03) {
        await anularVenta(ctxOwner, v.id, "Error de carga: se cobró dos veces");
        recientes.pop();
        stats.anuladas++;
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.fallidas++;
    }
  }

  async function precioLista(varianteId: string): Promise<Prisma.Decimal> {
    const v = await db.variante.findUniqueOrThrow({
      where: { id: varianteId },
      select: { precioVenta: true, producto: { select: { precioVenta: true } } },
    });
    return v.precioVenta ?? v.producto.precioVenta;
  }

  // --- Devoluciones por garantía: se entrega una unidad nueva del mismo sabor ----
  async function unaGarantia(anular: boolean) {
    const candidata = [...recientes].reverse().find((r) => r.venta.items.length > 0);
    if (!candidata) return;
    const item = candidata.venta.items[0]!;
    if ((await stockEn(item.varianteId, candidata.depositoId)) < 1) return;
    const d = await registrarDevolucion(
      ctxDe(elegir(cajeros[candidata.depositoId]!)),
      registrarDevolucionSchema.parse({
        clienteId: candidata.venta.cliente.id,
        ventaId: candidata.venta.id,
        depositoId: candidata.depositoId,
        items: [{ varianteId: item.varianteId, cantidad: 1 }],
        observacion: elegir(FALLAS),
      }),
    );
    recientes.splice(recientes.indexOf(candidata), 1);
    stats.devoluciones++;
    if (anular) await anularDevolucion(ctxOwner, d.id, "Se registró por error (demo)");
  }

  // --- Compras: reponer lo que está bajo ----------------------------------------
  async function unaCompra(depositoId: string) {
    const objetivo = depositoId === g1!.id ? 30 : 15;
    // Estos dos el importador no los trae más: van a quedar bajo mínimo / sin stock.
    const discontinuados = ["Ignite V80 8000|Grape Ice", "Elf Bar BC 5000|Lemon Mint"];
    const stocks = await Promise.all(
      vendibles
        .filter((v) => !discontinuados.includes(v.nombre))
        .map(async (v) => ({ v, s: await stockEn(v.id, depositoId) })),
    );
    // Lo que está por debajo de la mitad del objetivo; si no hay, los 3 más bajos.
    let reponer = stocks.filter((x) => x.s < objetivo * 0.5);
    if (reponer.length === 0) reponer = stocks.sort((a, b) => a.s - b.s).slice(0, 3);
    const items = [];
    for (const { v, s } of reponer) {
      const { ultimoCosto } = await db.variante.findUniqueOrThrow({ where: { id: v.id } });
      // El importador aumentó la lista de Ignite a mitad del período.
      const costo =
        precioActualizado && v.nombre.startsWith("Ignite V80 8000|")
          ? COSTO_IGNITE_NUEVO
          : (ultimoCosto?.toNumber() ?? COSTO_POR_DEFECTO);
      items.push({
        varianteId: v.id,
        cantidad: Math.max(objetivo - s, 6),
        costoUnitario: costo,
      });
    }
    const c = await crearCompra(ctxOwner, {
      proveedorId: elegir(proveedores).id,
      depositoId,
      fecha: ahora(),
      items,
      notas: undefined,
    });
    // Recibir actualiza el último costo de cada sabor; la mitad de las veces
    // también la lista de precios del proveedor.
    await recibirCompra(ctxOwner, c.id, { actualizarPrecioProveedor: azar() < 0.5 });
    stats.compras++;
  }

  let precioActualizado = false;
  const COSTO_IGNITE_NUEVO = 10200;

  for (let i = 0; i < DIAS; i++) {
    const dia = sumarDias(primerDia, i);
    const esHoy = dia === hoy;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 domingo
    const abierto = dow !== 0 || esHoy; // los domingos está cerrado

    // Aumento de lista del importador a mitad del período: sube el precio de
    // venta del producto (todos sus sabores sin precio propio) y, desde ahí,
    // las compras de Ignite entran al costo nuevo.
    if (!precioActualizado && i >= DIAS / 2) {
      fijarReloj(() => en(dia, 8, 30));
      const ignite = variantes.find((v) => v.nombre.startsWith("Ignite V80 8000|"));
      if (ignite) {
        await db.producto.update({
          where: { id: ignite.productoId },
          data: { precioVenta: "17500.00" },
        });
      }
      precioActualizado = true;
    }

    // Ventas del día: más los viernes y sábados.
    const cantidad = !abierto
      ? 0
      : Math.max(0, Math.round((dow === 5 || dow === 6 ? 3.8 : 2.4) + (azar() - 0.5) * 3));
    for (let k = 0; k < cantidad; k++) {
      const hh = ponderado([
        { valor: entre(10, 12), peso: 3 },
        { valor: entre(13, 16), peso: 3 },
        { valor: entre(17, 20), peso: 5 },
      ]);
      const dep = esHoy || azar() < 0.65 ? g1 : g2;
      agendar(dia, en(dia, hh, entre(0, 59)), () => unaVenta(dep.id));
    }
    // Compras cada ~4 días, alternando depósitos.
    if (i % 4 === 2) {
      const dep = (i / 4) % 2 < 1 ? g1 : g2;
      agendar(dia, en(dia, 9, 30), () => unaCompra(dep.id), 1);
    }
    // Ajustes de inventario: roturas y faltantes.
    if ([15, 38, 52, 66, 80].includes(i)) {
      agendar(dia, en(dia, 20, 30), async () => {
        const v = elegir(vendibles);
        const dep = i === 52 ? g2 : g1;
        const s = await stockEn(v.id, dep.id);
        if (s < 2) return;
        await registrarAjuste(ctxDe(i === 52 ? lucas! : ana!), {
          depositoId: dep.id,
          varianteId: v.id,
          cantidadReal: i === 66 ? s + 1 : s - entre(1, 2),
          motivo: i === 66 ? "Apareció en el recuento" : "Faltante en recuento semanal",
        });
        stats.ajustes++;
      });
    }
    // Garantías: cada ~9 días (una de ellas se anula).
    if (abierto && i % 9 === 5) {
      agendar(dia, en(dia, 18, 15), () => unaGarantia(i === 50), 6);
    }
    // Transferencias: una completada hace dos meses, una pendiente hace 3 días y otra de hoy.
    if (i === 25 || i === DIAS - 4 || esHoy) {
      agendar(
        dia,
        en(dia, 9, 45),
        async () => {
          const v = vendibles.find((x) => x.nombre === "Ignite V80 8000|Mango Ice")!;
          if ((await stockEn(v.id, g1.id)) < 6) return;
          const t = await crearTransferencia(ctxOwner, {
            depositoOrigenId: g1.id,
            depositoDestinoId: g2.id,
            fecha: ahora(),
            notas: "Reposición Mercedes",
            items: [{ varianteId: v.id, cantidad: 4 }],
          });
          if (i === 25) await completarTransferencia(ctxDe(lucas!), t.id);
          stats.transferencias++;
        },
        2,
      );
    }

    // Ejecutar el día en orden cronológico.
    const eventos = (agenda.get(dia) ?? []).sort(
      (a, b) => a.momento.getTime() - b.momento.getTime() || a.orden - b.orden,
    );
    for (const ev of eventos) {
      fijarReloj(() => ev.momento);
      await ev.hacer();
    }
    agenda.delete(dia);
  }

  // --- Cotizaciones: algunas de cada estado; dos se convierten en venta --------
  const cotizaciones = { creadas: 0, convertidas: 0 };
  {
    const elf = await db.variante.findMany({
      where: { deletedAt: null, producto: { nombreCompleto: "Elf Bar BC 5000" } },
      select: { id: true },
    });
    const conStock = (
      await Promise.all(elf.map(async (v) => ({ id: v.id, s: await stockEn(v.id, g1.id) })))
    ).sort((a, b) => b.s - a.s);
    const otros = vendibles.filter((v) => !elf.some((e) => e.id === v.id)).slice(0, 3);
    const vendedora = empleadosBase[0] ?? owner;
    const DUENO = { puedeEditar: true };
    const cliente = () => ({ id: elegir(clientes).id });
    const crear = async (
      quien: { id: string },
      datos: Parameters<typeof crearCotizacion>[1],
      permisos = DUENO,
    ) => {
      const c = await crearCotizacion(ctxDe(quien), datos, permisos);
      cotizaciones.creadas++;
      return c;
    };
    const mayoristaElf = conStock
      .slice(0, 2)
      .map((v) => ({ varianteId: v.id, cantidad: Math.max(1, Math.min(v.s, 30)) }));

    // Vencida: enviada hace 15 días con validez de 7.
    fijarReloj(() => en(sumarDias(hoy, -15), 11));
    const vieja = await crear(owner, {
      tipo: "MAYORISTA",
      items: mayoristaElf,
      cliente: cliente(),
      notas: "Pedido para reventa (demo)",
    });
    await marcarEnviada(ctxOwner, vieja.id);

    fijarReloj(() => en(sumarDias(hoy, -3), 12));
    const rechazada = await crear(
      vendedora,
      {
        tipo: "UNITARIA",
        items: otros.map((v) => ({ varianteId: v.id, cantidad: 2 })),
        cliente: cliente(),
      },
      { puedeEditar: false },
    );
    await marcarEnviada(ctxDe(vendedora), rechazada.id);
    await marcarRechazada(ctxDe(vendedora), rechazada.id, "Le pareció caro");

    fijarReloj(() => en(sumarDias(hoy, -2), 16));
    const aceptada = await crear(owner, {
      tipo: "MAYORISTA",
      items: otros.map((v) => ({ varianteId: v.id, cantidad: 12 })),
      cliente: { nombre: "Kiosco La Esquina", telefono: "11 6999-1234" },
      descuento: 1000,
    });
    await marcarEnviada(ctxOwner, aceptada.id);
    await marcarAceptada(ctxOwner, aceptada.id);

    fijarReloj(() => en(sumarDias(hoy, -1), 18));
    const enviada = await crear(
      vendedora,
      {
        tipo: "UNITARIA",
        items: mayoristaElf.map((i) => ({ ...i, cantidad: 3 })),
        cliente: cliente(),
      },
      { puedeEditar: false },
    );
    await marcarEnviada(ctxDe(vendedora), enviada.id);

    fijarReloj(() => new Date(ahoraReal.getTime() - 90 * 60_000));
    await crear(owner, {
      tipo: "MAYORISTA",
      items: mayoristaElf.map((i) => ({ ...i, cantidad: 25 })),
      cliente: null,
      notas: "Consulta por Instagram (demo)",
    });

    // Convertidas: una mayorista a un cliente existente y una unitaria a un cliente nuevo.
    fijarReloj(() => new Date(ahoraReal.getTime() - 60 * 60_000));
    const aConvertir = [
      await crear(owner, {
        tipo: "MAYORISTA",
        items: mayoristaElf.map((i) => ({
          ...i,
          cantidad: Math.max(1, Math.floor(i.cantidad / 3)),
        })),
        cliente: cliente(),
      }),
      await crear(
        vendedora,
        {
          tipo: "UNITARIA",
          items: [{ varianteId: conStock[0]!.id, cantidad: 1 }],
          cliente: { nombre: "Rocío Demo", telefono: "11 6999-5678" },
        },
        { puedeEditar: false },
      ),
    ];
    for (const c of aConvertir) {
      await marcarEnviada(ctxOwner, c.id);
      try {
        await convertirEnVenta(ctxOwner, c.id, {
          depositoId: g1.id,
          medioPago: MedioPago.EFECTIVO,
        });
        cotizaciones.convertidas++;
        stats.ventas++;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
    fijarReloj(null);
    // Pasa a VENCIDA las que ya no valen.
    await listarCotizaciones(ctxOwner, {});
  }

  // Pendiente para el dashboard: una compra sin recibir.
  fijarReloj(() => new Date(ahoraReal.getTime() - 20 * 60_000));
  await crearCompra(ctxOwner, {
    proveedorId: proveedores[1]!.id,
    depositoId: g1.id,
    fecha: ahora(),
    items: [{ varianteId: vendibles[0]!.id, cantidad: 10, costoUnitario: COSTO_POR_DEFECTO }],
    notas: "Pedido a confirmar (demo)",
  });
  fijarReloj(null);

  const [ventas, total] = await Promise.all([
    db.venta.groupBy({ by: ["estado"], _count: true }),
    db.venta.aggregate({ where: { estado: "CONFIRMADA" }, _sum: { total: true } }),
  ]);
  console.log("seed-demo OK (panel Vapes)", {
    ...stats,
    cotizaciones,
    ventasPorEstado: Object.fromEntries(ventas.map((v) => [v.estado, v._count])),
    facturado: (total._sum.total ?? new Prisma.Decimal(0)).toString(),
    desde: primerDia,
    hasta: hoy,
  });
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
