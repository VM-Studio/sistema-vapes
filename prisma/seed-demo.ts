/**
 * SEED DEMO — 90 días de operación simulada para probar dashboard y reportes.
 * Separado del seed base (que sigue siendo el mínimo para arrancar).
 *
 * No inserta filas "a mano": fija el reloj de negocio (src/lib/reloj.ts) en
 * cada momento simulado y llama a los MISMOS servicios que la app (vender,
 * cobrar, devolver, anular, compras, gastos, cajas). Así los triggers, la caja
 * y el ResumenDiario incremental se ejercitan de verdad.
 *
 * Uso (sobre una DB con el seed base): pnpm db:seed-demo
 * Idempotente: si ya corrió (Configuracion.seedDemo), no hace nada.
 * Determinístico: PRNG con semilla fija.
 */
import { MedioPago, Modulo, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { generarEan13 } from "../src/lib/barcode";
import { prisma, withTransaction } from "../src/lib/db";
import { ahora, fijarReloj } from "../src/lib/reloj";
import type { GastoInput } from "../src/lib/validations/finanzas";
import { borradorVentaSchema } from "../src/lib/validations/venta";
import { diaEn, inicioDia, sumarDias, type DiaISO } from "../src/lib/zona-horaria";
import { DomainError } from "../src/server/errors";
import type { Actor } from "../src/server/services/actor";
import { abrirCaja, cerrarCaja, obtenerCajaAbierta } from "../src/server/services/caja.service";
import { crearCompra, recibirCompra } from "../src/server/services/compra.service";
import { obtenerZonaHoraria } from "../src/server/services/configuracion.service";
import { crearGasto } from "../src/server/services/gasto.service";
import {
  crearTransferencia,
  completarTransferencia,
  registrarAjuste,
} from "../src/server/services/movimiento.service";
import { actualizarPrecios, generarSku } from "../src/server/services/producto.service";
import { registrarMovimiento } from "../src/server/services/stock.service";
import {
  anularVenta,
  crearBorrador,
  crearDevolucion,
  pagarACuenta,
  registrarPago,
  vender,
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

const DIAS = 90;
const DUENO = { puedeEditar: true };

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
  nombre: string;
  categoria: string;
  marca: string;
  tieneVariantes: boolean;
  costo: string;
  venta: string;
  minimo: number;
  sabores: { nombre: string; ean12: string; peso: number; stock: [number, number] }[];
}

const PRODUCTOS_DEMO: ProductoDemo[] = [
  {
    nombre: "Lost Mary MO5000",
    categoria: "Vapes",
    marca: "Lost Mary",
    tieneVariantes: true,
    costo: "8800.00",
    venta: "15500.00",
    minimo: 8,
    sabores: [
      { nombre: "Blue Razz", ean12: "779000400001", peso: 9, stock: [20, 10] },
      { nombre: "Watermelon", ean12: "779000400002", peso: 7, stock: [18, 8] },
      { nombre: "Grape", ean12: "779000400003", peso: 4, stock: [12, 6] },
      { nombre: "Peach Ice", ean12: "779000400004", peso: 3, stock: [10, 4] },
      // Nunca se vende: tiene que aparecer como SIN_MOVIMIENTO.
      { nombre: "Café Tabaco", ean12: "779000400005", peso: 0, stock: [15, 0] },
    ],
  },
  {
    nombre: "Nasty Salt 30ml",
    categoria: "Líquidos",
    marca: "Nasty Juice",
    tieneVariantes: true,
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
    nombre: "Vaporesso XROS 3",
    categoria: "Pods",
    marca: "Vaporesso",
    tieneVariantes: false,
    costo: "18000.00",
    venta: "32000.00",
    minimo: 2,
    sabores: [{ nombre: "Único", ean12: "779000600001", peso: 1, stock: [5, 2] }],
  },
];

/** Popularidad de las variantes del seed base. */
const PESOS_BASE: Record<string, number> = {
  "Ignite V80|Mango Ice": 10,
  "Ignite V80|Strawberry Watermelon": 7,
  "Ignite V80|Blue Razz Ice": 8,
  "Ignite V80|Grape Ice": 4,
  "Elf Bar BC5000|Watermelon Ice": 7,
  "Elf Bar BC5000|Peach Mango": 5,
  "Elf Bar BC5000|Cool Mint": 4,
  "Elf Bar BC5000|Lemon Mint": 2,
  "Cargador USB-C 20W|Único": 3,
  "Parlante Bluetooth Mini|Único": 1,
};

interface VarianteDemo {
  id: string;
  nombre: string;
  peso: number;
}

async function crearCatalogoDemo(ownerId: string, g1: string, g2: string) {
  for (const p of PRODUCTOS_DEMO) {
    const categoria = await prisma.categoria.findUniqueOrThrow({ where: { nombre: p.categoria } });
    const marca = await prisma.marca.upsert({
      where: { nombre: p.marca },
      update: {},
      create: { nombre: p.marca },
    });
    await withTransaction(async (tx) => {
      const producto = await tx.producto.create({
        data: {
          nombre: p.nombre,
          categoriaId: categoria.id,
          marcaId: marca.id,
          tieneVariantes: p.tieneVariantes,
          descripcion: `${p.nombre} (demo)`,
        },
      });
      for (const s of p.sabores) {
        const variante = await tx.variante.create({
          data: {
            productoId: producto.id,
            nombre: s.nombre,
            sku: await generarSku(tx),
            codigoBarras: generarEan13(s.ean12),
            precioCosto: p.costo,
            precioVenta: p.venta,
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
              usuarioId: ownerId,
            });
          }
        }
      }
    });
  }
}

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
    for (const [modulo, crear] of [
      [Modulo.VENTAS, true],
      [Modulo.INVENTARIO, true],
      [Modulo.CLIENTES, false],
      [Modulo.CAJA, true],
    ] as const) {
      await prisma.permisoUsuario.upsert({
        where: { usuarioId_modulo: { usuarioId: usuario.id, modulo } },
        update: {},
        create: { usuarioId: usuario.id, modulo, puedeVer: true, puedeCrear: crear },
      });
    }
    vendedores.push(usuario);
  }
  return vendedores;
}

const CLIENTES_DEMO = [
  {
    nombre: "Sofía",
    apellido: "Ramírez",
    documento: "35111222",
    telefono: "11 5555-0201",
    limiteCredito: "60000.00",
  },
  {
    nombre: "Julián",
    apellido: "Pereyra",
    documento: "33222333",
    telefono: "11 5555-0202",
    limiteCredito: "40000.00",
  },
  {
    nombre: "Camila",
    apellido: "Torres",
    documento: "38333444",
    telefono: "11 5555-0203",
    limiteCredito: null,
  },
  {
    nombre: "Kiosco El Paso",
    apellido: null,
    documento: "30712222334",
    telefono: "11 5555-0204",
    limiteCredito: "150000.00",
  },
  {
    nombre: "Matías",
    apellido: "Luna",
    documento: "36444555",
    telefono: "11 5555-0205",
    limiteCredito: "30000.00",
  },
  {
    nombre: "Valentina",
    apellido: "Sosa",
    documento: "39555666",
    telefono: "11 5555-0206",
    limiteCredito: null,
  },
];

const PROVEEDORES_DEMO = [
  { nombre: "Importadora Vapor Sur SA", cuit: "30716543218" },
  { nombre: "TechPro Mayorista", cuit: "30709876543" },
];

// -----------------------------------------------------------------------------
// Simulación
// -----------------------------------------------------------------------------

type Evento = { momento: Date; orden: number; hacer: () => Promise<void> };

async function main() {
  if (await prisma.configuracion.findUnique({ where: { clave: "seedDemo" } })) {
    console.log("seed-demo ya se corrió en esta base: no hago nada.");
    return;
  }
  const tz = await obtenerZonaHoraria();
  const ahoraReal = new Date();
  const hoy = diaEn(ahoraReal, tz);
  const primerDia = sumarDias(hoy, -(DIAS - 1));
  const en = (dia: DiaISO, hh: number, mm = 0) =>
    new Date(inicioDia(dia, tz).getTime() + (hh * 60 + mm) * 60_000);

  const [owner, owner2] = await prisma.usuario.findMany({
    where: { rol: RolUsuario.OWNER },
    orderBy: { email: "asc" },
  });
  const empleado = await prisma.usuario.findUniqueOrThrow({
    where: { email: "empleado@negocio.com" },
  });
  const depositos = await prisma.deposito.findMany({
    orderBy: [{ esPrincipal: "desc" }, { nombre: "asc" }],
  });
  const [g1, g2] = depositos as [(typeof depositos)[number], (typeof depositos)[number]];
  if (!owner || !owner2 || !g1 || !g2)
    throw new Error("Corré primero el seed base (pnpm db:seed).");

  // El catálogo y el stock inicial "existen" desde antes del primer día.
  fijarReloj(() => en(sumarDias(primerDia, -1), 10));
  await crearCatalogoDemo(owner.id, g1.id, g2.id);
  const [ana, lucas] = await crearUsuariosDemo();
  const clientes: { id: string; nombre: string; limiteCredito: Prisma.Decimal | null }[] = [];
  for (const c of CLIENTES_DEMO) {
    const existe = await prisma.cliente.findFirst({
      where: { documento: c.documento, deletedAt: null },
    });
    clientes.push(existe ?? (await prisma.cliente.create({ data: c })));
  }
  const proveedores = [
    await prisma.proveedor.findFirstOrThrow({ where: { deletedAt: null } }),
    ...(await Promise.all(PROVEEDORES_DEMO.map((p) => prisma.proveedor.create({ data: p })))),
  ];
  const fiables = clientes.filter((c) => c.limiteCredito !== null);

  const variantes: VarianteDemo[] = (
    await prisma.variante.findMany({
      where: { deletedAt: null },
      include: { producto: { select: { nombre: true } } },
    })
  ).map((v) => {
    const clave = `${v.producto.nombre}|${v.nombre}`;
    const demo = PRODUCTOS_DEMO.find((p) => p.nombre === v.producto.nombre)?.sabores.find(
      (s) => s.nombre === v.nombre,
    );
    return { id: v.id, nombre: clave, peso: demo?.peso ?? PESOS_BASE[clave] ?? 1 };
  });
  const vendibles = variantes.filter((v) => v.peso > 0);

  const actorDe = (u: { id: string }): Actor => ({
    id: u.id,
    meta: { ip: "127.0.0.1", userAgent: "seed-demo" },
  });
  const cajeros = { [g1.id]: [owner, ana!, empleado], [g2.id]: [lucas!, owner2] } as Record<
    string,
    { id: string }[]
  >;

  const stats = {
    ventas: 0,
    fiadas: 0,
    anuladas: 0,
    devoluciones: 0,
    cobros: 0,
    compras: 0,
    gastos: 0,
    cajas: 0,
    fallidas: 0,
  };
  const ventasFiadas: { id: string; dia: DiaISO; clienteId: string; depositoId: string }[] = [];
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
      await prisma.stock.findUnique({
        where: { varianteId_depositoId: { varianteId, depositoId } },
      })
    )?.cantidad ?? 0;

  // --- Ventas ------------------------------------------------------------------
  async function unaVenta(dia: DiaISO, depositoId: string, soloEfectivo = false) {
    const cajero = elegir(cajeros[depositoId]!);
    const lineas = new Map<string, number>();
    for (
      let i = 0,
        n = ponderado([
          { valor: 1, peso: 6 },
          { valor: 2, peso: 3 },
          { valor: 3, peso: 1 },
        ]);
      i < n;
      i++
    ) {
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
    const tipo = soloEfectivo
      ? "efectivo"
      : ponderado([
          { valor: "efectivo", peso: 45 },
          { valor: "transferencia", peso: 18 },
          { valor: "mercadopago", peso: 12 },
          { valor: "debito", peso: 10 },
          { valor: "partido", peso: 8 },
          { valor: "fiado", peso: 9 },
        ] as const);
    const cliente = tipo === "fiado" ? elegir(fiables) : azar() < 0.2 ? elegir(clientes) : null;
    const borrador = borradorVentaSchema.parse({
      depositoId,
      clienteId: cliente?.id,
      items: [...lineas].map(([varianteId, cantidad]) => ({ varianteId, cantidad })),
    });
    const precios = await prisma.variante.findMany({
      where: { id: { in: [...lineas.keys()] } },
      select: { id: true, precioVenta: true },
    });
    const total = precios.reduce(
      (a, p) => a.plus(p.precioVenta.mul(lineas.get(p.id)!)),
      new Prisma.Decimal(0),
    );
    const pagos =
      tipo === "efectivo"
        ? [{ medioPago: MedioPago.EFECTIVO, monto: total.toNumber() }]
        : tipo === "transferencia"
          ? [
              {
                medioPago: MedioPago.TRANSFERENCIA,
                monto: total.toNumber(),
                referencia: `OP-${entre(100000, 999999)}`,
              },
            ]
          : tipo === "mercadopago"
            ? [{ medioPago: MedioPago.MERCADOPAGO, monto: total.toNumber() }]
            : tipo === "debito"
              ? [{ medioPago: MedioPago.DEBITO, monto: total.toNumber() }]
              : tipo === "partido"
                ? [
                    { medioPago: MedioPago.EFECTIVO, monto: 10000 },
                    { medioPago: MedioPago.TRANSFERENCIA, monto: total.minus(10000).toNumber() },
                  ].filter((p) => p.monto > 0)
                : azar() < 0.5
                  ? [
                      {
                        medioPago: MedioPago.EFECTIVO,
                        monto: Math.floor(total.toNumber() / 3 / 100) * 100,
                      },
                    ].filter((p) => p.monto > 0)
                  : [];
    try {
      const v = await vender({ venta: borrador, pagos, redondearA: 0 }, actorDe(cajero), DUENO);
      stats.ventas++;
      if (tipo === "fiado" && cliente) {
        stats.fiadas++;
        ventasFiadas.push({ id: v.id, dia, clienteId: cliente.id, depositoId });
        // 70% se cobra entre 3 y 25 días después.
        if (azar() < 0.7) {
          const diaCobro = sumarDias(dia, entre(3, 25));
          agendar(diaCobro, en(diaCobro, entre(11, 19), entre(0, 59)), async () => {
            const venta = await prisma.venta.findUniqueOrThrow({ where: { id: v.id } });
            if (venta.estado !== "CONFIRMADA" || venta.saldoPendiente.lte(0)) return;
            await registrarPago(
              v.id,
              {
                medioPago: azar() < 0.6 ? MedioPago.EFECTIVO : MedioPago.TRANSFERENCIA,
                monto: venta.saldoPendiente.toNumber(),
              },
              actorDe(elegir(cajeros[depositoId]!)),
            );
            stats.cobros++;
          });
        }
      }
      // ~2%: se anula en el momento (error de carga).
      if (azar() < 0.035) {
        await anularVenta(v.id, "Error de carga: se cobró dos veces", actorDe(owner!));
        stats.anuladas++;
      } else if (azar() < 0.05) {
        // ~5%: el cliente vuelve a devolver algo entre 1 y 6 días después.
        const diaDev = sumarDias(dia, entre(1, 6));
        agendar(diaDev, en(diaDev, entre(12, 18), entre(0, 59)), async () => {
          const venta = await prisma.venta.findUniqueOrThrow({
            where: { id: v.id },
            include: { items: true },
          });
          if (venta.estado !== "CONFIRMADA") return;
          const item = venta.items[0]!;
          const dinero = venta.montoPagado.greaterThan(0);
          const devolver = (medioPago: "EFECTIVO" | "TRANSFERENCIA") =>
            crearDevolucion(
              {
                ventaId: v.id,
                depositoId,
                motivo: elegir(["Vino fallado", "No le gustó el sabor", "Cambio de opinión"]),
                items: [{ ventaItemId: item.id, cantidad: 1 }],
                reintegro:
                  dinero || !venta.clienteId
                    ? { tipo: "dinero", medioPago }
                    : { tipo: "cuentaCorriente" },
              },
              actorDe(owner!),
            );
          try {
            await devolver(MedioPago.EFECTIVO);
          } catch (e) {
            if (!(e instanceof DomainError)) throw e;
            if (e.code === "EFECTIVO_INSUFICIENTE") {
              // En la caja no alcanza: se le devuelve por transferencia.
              await devolver(MedioPago.TRANSFERENCIA);
            } else if (venta.clienteId) {
              // Fiado a medio pagar: se acredita a su cuenta.
              await crearDevolucion(
                {
                  ventaId: v.id,
                  depositoId,
                  motivo: "Vino fallado",
                  items: [{ ventaItemId: item.id, cantidad: 1 }],
                  reintegro: { tipo: "cuentaCorriente" },
                },
                actorDe(owner!),
              );
            } else return;
          }
          stats.devoluciones++;
        });
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      stats.fallidas++;
    }
  }

  // --- Compras: reponer lo que está bajo ----------------------------------------
  async function unaCompra(dia: DiaISO, depositoId: string) {
    const objetivo = depositoId === g1.id ? 30 : 15;
    // Estos dos el importador no los trae más: van a quedar bajo mínimo / sin stock.
    const discontinuados = ["Ignite V80|Grape Ice", "Elf Bar BC5000|Lemon Mint"];
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
      const costo = (await prisma.variante.findUniqueOrThrow({ where: { id: v.id } })).precioCosto;
      items.push({
        varianteId: v.id,
        cantidad: Math.max(objetivo - s, 6),
        costoUnitario: costo.toNumber(),
      });
    }
    const proveedor = elegir(proveedores);
    const c = await crearCompra(
      {
        proveedorId: proveedor.id,
        depositoId,
        fecha: ahora(),
        descuento: 0,
        notas: undefined,
        items,
      },
      actorDe(owner!),
    );
    await recibirCompra(c.id, actorDe(owner!), { actualizarCostos: false });
    stats.compras++;
  }

  // --- Gastos -------------------------------------------------------------------
  const GASTOS_FIJOS: {
    dia: number;
    cat: string;
    desc: string;
    monto: number;
    medio: GastoInput["medioPago"];
    dep: string | null;
    rec: boolean;
  }[] = [
    {
      dia: 1,
      cat: "cgasto_alquiler",
      desc: "Alquiler Galpón 1",
      monto: 220000,
      medio: MedioPago.TRANSFERENCIA,
      dep: g1.id,
      rec: true,
    },
    {
      dia: 1,
      cat: "cgasto_alquiler",
      desc: "Alquiler Galpón 2",
      monto: 140000,
      medio: MedioPago.TRANSFERENCIA,
      dep: g2.id,
      rec: true,
    },
    {
      dia: 5,
      cat: "cgasto_servicios",
      desc: "Luz Galpón 1",
      monto: 26000,
      medio: MedioPago.DEBITO,
      dep: g1.id,
      rec: true,
    },
    {
      dia: 6,
      cat: "cgasto_servicios",
      desc: "Internet Galpón 2",
      monto: 15000,
      medio: MedioPago.DEBITO,
      dep: g2.id,
      rec: true,
    },
    {
      dia: 4,
      cat: "cgasto_sueldos",
      desc: "Comisión Ana",
      monto: 65000,
      medio: MedioPago.TRANSFERENCIA,
      dep: null,
      rec: true,
    },
    {
      dia: 4,
      cat: "cgasto_sueldos",
      desc: "Comisión Lucas",
      monto: 55000,
      medio: MedioPago.TRANSFERENCIA,
      dep: null,
      rec: true,
    },
    {
      dia: 10,
      cat: "cgasto_impuestos",
      desc: "Monotributo",
      monto: 45000,
      medio: MedioPago.DEBITO,
      dep: null,
      rec: true,
    },
  ];
  const variables: {
    cat: string;
    desc: string;
    min: number;
    max: number;
    medio: GastoInput["medioPago"];
  }[] = [
    ...Array.from({ length: 8 }, () => ({
      cat: "cgasto_envios",
      desc: elegir(["Envío moto a cliente", "Flete mercadería", "Cadete"]),
      min: 3500,
      max: 9000,
      medio: MedioPago.EFECTIVO,
    })),
    ...Array.from({ length: 6 }, () => ({
      cat: "cgasto_insumos",
      desc: elegir(["Bolsas y cinta", "Etiquetas térmicas", "Artículos de limpieza"]),
      min: 2500,
      max: 12000,
      medio: MedioPago.EFECTIVO,
    })),
    ...Array.from({ length: 4 }, () => ({
      cat: "cgasto_marketing",
      desc: "Publicidad Instagram",
      min: 15000,
      max: 40000,
      medio: MedioPago.CREDITO,
    })),
    ...Array.from({ length: 2 }, () => ({
      cat: "cgasto_otros",
      desc: "Reparación mostrador",
      min: 8000,
      max: 20000,
      medio: MedioPago.EFECTIVO,
    })),
  ];
  const diasVariables = new Map<DiaISO, (typeof variables)[number][]>();
  for (const g of variables) {
    const d = sumarDias(primerDia, entre(0, DIAS - 1));
    diasVariables.set(d, [...(diasVariables.get(d) ?? []), g]);
  }

  // --- Días -----------------------------------------------------------------------
  const DIFERENCIAS: Record<number, { monto: number; obs?: string }> = {
    12: { monto: -500 },
    27: { monto: -1200, obs: "Faltante: se dio mal un vuelto" },
    41: { monto: 300 },
    58: { monto: -2000, obs: "Faltan $2.000, se revisan las cámaras" },
    73: { monto: -100 },
    84: { monto: 800, obs: "Sobrante: cobro de un fiado sin registrar" },
  };
  let precioActualizado = false;

  for (let i = 0; i < DIAS; i++) {
    const dia = sumarDias(primerDia, i);
    const esHoy = dia === hoy;
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 domingo
    const abierto = dow !== 0 || esHoy; // los domingos está cerrado

    // Aumento de lista a mitad del período (HistorialPrecio).
    if (!precioActualizado && i >= DIAS / 2) {
      fijarReloj(() => en(dia, 8, 30));
      const ignite = variantes.filter((v) => v.nombre.startsWith("Ignite V80|")).map((v) => v.id);
      await actualizarPrecios(
        ignite,
        { precioCosto: 10200, precioVenta: 17500 },
        actorDe(owner!),
        "Aumento del importador",
      );
      precioActualizado = true;
    }

    // Apertura de cajas (hoy, la del Galpón 2 todavía no abrió).
    const apertura = esHoy
      ? new Date(Math.min(en(dia, 9).getTime(), ahoraReal.getTime() - 3 * 3600_000))
      : en(dia, 9);
    for (const dep of !abierto ? [] : esHoy ? [g1] : [g1, g2]) {
      // Algunos días el Galpón 2 abre la caja a las 15: lo cobrado antes queda "fuera de caja".
      const abrir = async () => {
        await abrirCaja(
          { depositoId: dep.id, montoInicial: dep.id === g1.id ? 20000 : 10000 },
          actorDe(cajeros[dep.id]![0]!),
        );
        stats.cajas++;
      };
      if (dep.id === g2.id && i % 9 === 4) {
        agendar(dia, en(dia, 15), abrir, 0);
        // Mientras tanto se vende igual: ese efectivo queda fuera de caja.
        for (const hh of [11, 13])
          agendar(dia, en(dia, hh, entre(0, 59)), () => unaVenta(dia, g2.id, true));
      } else {
        fijarReloj(() => apertura);
        await abrir();
      }
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
      agendar(dia, en(dia, hh, entre(0, 59)), () => unaVenta(dia, dep.id));
    }
    // Compras cada ~4-5 días, alternando galpones.
    if (i % 4 === 2) {
      const dep = (i / 4) % 2 < 1 ? g1 : g2;
      agendar(dia, en(dia, 9, 30), () => unaCompra(dia, dep.id), 1);
    }
    // Gastos fijos del mes (en Septiembre, Internet todavía no se cargó: recordatorio).
    for (const g of GASTOS_FIJOS) {
      if (Number(dia.slice(8)) !== g.dia) continue;
      if (dia.slice(0, 7) === hoy.slice(0, 7) && g.desc === "Internet Galpón 2") continue;
      agendar(dia, en(dia, 10, 15), async () => {
        await crearGasto(
          {
            fecha: dia,
            categoriaGastoId: g.cat,
            descripcion: g.desc,
            monto: g.monto,
            medioPago: g.medio,
            depositoId: g.dep ?? undefined,
            recurrente: g.rec,
          },
          null,
          actorDe(owner!),
        );
        stats.gastos++;
      });
    }
    for (const g of diasVariables.get(dia) ?? []) {
      agendar(dia, en(dia, entre(11, 18), entre(0, 59)), async () => {
        const datos: GastoInput = {
          fecha: dia,
          categoriaGastoId: g.cat,
          descripcion: g.desc,
          monto: Math.round(entre(g.min, g.max) / 100) * 100,
          medioPago: g.medio,
          depositoId: azar() < 0.7 ? g1.id : g2.id,
          recurrente: false,
        };
        try {
          await crearGasto(datos, null, actorDe(owner!));
        } catch (e) {
          // En la caja no alcanzaba: lo paga el dueño con débito.
          if (!(e instanceof DomainError)) throw e;
          await crearGasto({ ...datos, medioPago: MedioPago.DEBITO }, null, actorDe(owner!));
        }
        stats.gastos++;
      });
    }
    // Ajustes de inventario (auditoría): roturas y faltantes.
    if ([15, 38, 52, 66, 80].includes(i)) {
      agendar(dia, en(dia, 20, 30), async () => {
        const v = elegir(vendibles);
        const dep = i === 52 ? g2 : g1;
        const s = await stockEn(v.id, dep.id);
        if (s < 2) return;
        await registrarAjuste(
          {
            depositoId: dep.id,
            varianteId: v.id,
            cantidadReal: i === 66 ? s + 1 : s - entre(1, 2),
            motivo: i === 66 ? "Apareció en el recuento" : "Faltante en recuento semanal",
          },
          actorDe(i === 52 ? lucas! : ana!),
        );
      });
    }
    // Transferencias: una completada hace dos meses, una pendiente hace 3 días y otra de hoy.
    if (i === 25 || i === DIAS - 4 || esHoy) {
      agendar(
        dia,
        en(dia, 9, 45),
        async () => {
          const v = vendibles.find((x) => x.nombre === "Ignite V80|Mango Ice")!;
          if ((await stockEn(v.id, g1.id)) < 6) return;
          const t = await crearTransferencia(
            {
              depositoOrigenId: g1.id,
              depositoDestinoId: g2.id,
              fecha: ahora(),
              notas: "Reposición Galpón 2",
              items: [{ varianteId: v.id, cantidad: 4 }],
            },
            actorDe(owner!),
          );
          if (i === 25) await completarTransferencia(t.id, actorDe(lucas!));
        },
        2,
      );
    }
    // Un pago a cuenta grande del kiosco (efectivo) a mitad de período.
    if (i === 60) {
      agendar(dia, en(dia, 16, 20), async () => {
        const kiosco = clientes.find((c) => c.nombre === "Kiosco El Paso")!;
        const deuda = (await prisma.cliente.findUniqueOrThrow({ where: { id: kiosco.id } }))
          .saldoDeudor;
        if (deuda.lte(0)) return;
        await pagarACuenta(
          {
            clienteId: kiosco.id,
            medioPago: MedioPago.EFECTIVO,
            monto: Math.min(deuda.toNumber(), 25000),
            depositoId: g1.id,
          },
          actorDe(owner!),
        );
        stats.cobros++;
      });
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

    // Cierre (hoy la caja del Galpón 1 queda abierta).
    if (!esHoy) {
      for (const dep of [g1, g2]) {
        fijarReloj(() => en(dia, 21, 30));
        const caja = await obtenerCajaAbierta(dep.id);
        if (!caja) continue;
        const dif = dep.id === g1.id ? DIFERENCIAS[i] : undefined;
        await cerrarCaja(
          caja.id,
          {
            montoContado: Math.max(0, Number(caja.totales.esperado) + (dif?.monto ?? 0)),
            observaciones: dif?.obs,
          },
          actorDe(cajeros[dep.id]![0]!),
        );
      }
    }
  }

  // Pendientes para el dashboard: dos borradores de venta y una compra sin recibir.
  fijarReloj(() => new Date(ahoraReal.getTime() - 20 * 60_000));
  for (const v of vendibles.slice(0, 2)) {
    await crearBorrador(
      borradorVentaSchema.parse({
        depositoId: g1.id,
        items: [{ varianteId: v.id, cantidad: 1 }],
        notas: "Presupuesto (demo)",
      }),
      actorDe(ana!),
      DUENO,
    );
  }
  await crearCompra(
    {
      proveedorId: proveedores[1]!.id,
      depositoId: g1.id,
      descuento: 0,
      items: [{ varianteId: vendibles[0]!.id, cantidad: 10, costoUnitario: 9000 }],
      notas: "Pedido a confirmar (demo)",
    },
    actorDe(owner!),
  );
  fijarReloj(null);

  await prisma.configuracion.create({
    data: { clave: "seedDemo", valor: { fecha: ahoraReal.toISOString(), ...stats } },
  });
  const [ventas, resumenes, cajas] = await Promise.all([
    prisma.venta.groupBy({ by: ["estado"], _count: true }),
    prisma.resumenDiario.count(),
    prisma.caja.groupBy({ by: ["estado"], _count: true }),
  ]);
  console.log("seed-demo OK", {
    ...stats,
    ventasPorEstado: Object.fromEntries(ventas.map((v) => [v.estado, v._count])),
    cajasPorEstado: Object.fromEntries(cajas.map((c) => [c.estado, c._count])),
    filasResumenDiario: resumenes,
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
