/**
 * Seed idempotente: correrlo N veces deja la DB en el mismo estado.
 * - Todo por upsert sobre claves únicas naturales (email, nombre, sku...).
 * - El stock inicial se carga SOLO con registrarMovimiento (INGRESO_MANUAL),
 *   y solo si ese (variante, depósito) todavía no tiene su movimiento de seed.
 */
import { Modulo, Prisma, RolUsuario, TipoComprobante, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { generarEan13 } from "../src/lib/barcode";
import { prisma, withTransaction } from "../src/lib/db";
import { generarSku } from "../src/server/services/catalogo.service";
import { registrarMovimiento } from "../src/server/services/stock.service";

const PASSWORD_INICIAL = "Cambiar123!";
const MOTIVO_STOCK_INICIAL = "Stock inicial (seed)";

const CONFIGURACION: Record<string, Prisma.InputJsonValue> = {
  nombreNegocio: "Mi Negocio",
  moneda: "ARS",
  alertaStockMinimo: true,
  prefijoSku: "PRD",
};

interface VarianteSeed {
  nombre: string;
  /** 12 dígitos base: el verificador EAN-13 se calcula. */
  ean12?: string;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: number;
  /** Stock inicial por depósito: [Galpón 1, Galpón 2]. */
  stock: [number, number];
}

interface ProductoSeed {
  nombre: string;
  descripcion: string;
  categoria: string;
  marca: string;
  tieneVariantes: boolean;
  variantes: VarianteSeed[];
}

// 779 = prefijo GS1 Argentina; el resto es ficticio.
const PRODUCTOS: ProductoSeed[] = [
  {
    nombre: "Ignite V80",
    descripcion: "Vape descartable 8000 puffs",
    categoria: "Vapes",
    marca: "Ignite",
    tieneVariantes: true,
    variantes: [
      {
        nombre: "Mango Ice",
        ean12: "779000100001",
        precioCosto: "9500.00",
        precioVenta: "16000.00",
        stockMinimo: 10,
        stock: [24, 12],
      },
      {
        nombre: "Strawberry Watermelon",
        ean12: "779000100002",
        precioCosto: "9500.00",
        precioVenta: "16000.00",
        stockMinimo: 10,
        stock: [18, 6],
      },
      {
        nombre: "Blue Razz Ice",
        ean12: "779000100003",
        precioCosto: "9500.00",
        precioVenta: "16000.00",
        stockMinimo: 10,
        stock: [30, 10],
      },
      {
        nombre: "Grape Ice",
        ean12: "779000100004",
        precioCosto: "9500.00",
        precioVenta: "16000.00",
        stockMinimo: 10,
        stock: [4, 2],
      },
    ],
  },
  {
    nombre: "Elf Bar BC5000",
    descripcion: "Vape descartable recargable 5000 puffs",
    categoria: "Vapes",
    marca: "Elf Bar",
    tieneVariantes: true,
    variantes: [
      {
        nombre: "Watermelon Ice",
        ean12: "779000200001",
        precioCosto: "8200.00",
        precioVenta: "14500.00",
        stockMinimo: 8,
        stock: [20, 10],
      },
      {
        nombre: "Peach Mango",
        ean12: "779000200002",
        precioCosto: "8200.00",
        precioVenta: "14500.00",
        stockMinimo: 8,
        stock: [15, 5],
      },
      {
        nombre: "Cool Mint",
        ean12: "779000200003",
        precioCosto: "8200.00",
        precioVenta: "14500.00",
        stockMinimo: 8,
        stock: [12, 12],
      },
      {
        nombre: "Lemon Mint",
        ean12: "779000200004",
        precioCosto: "8200.00",
        precioVenta: "14500.00",
        stockMinimo: 8,
        stock: [0, 3],
      },
    ],
  },
  {
    nombre: "Cargador USB-C 20W",
    descripcion: "Cargador de pared USB-C con carga rápida",
    categoria: "Accesorios",
    marca: "TechPro",
    tieneVariantes: false,
    variantes: [
      {
        nombre: "Único",
        ean12: "779000300001",
        precioCosto: "4500.00",
        precioVenta: "8900.00",
        stockMinimo: 5,
        stock: [15, 5],
      },
    ],
  },
  {
    nombre: "Parlante Bluetooth Mini",
    descripcion: "Parlante portátil Bluetooth 5.0, 10W",
    categoria: "Artefactos",
    marca: "TechPro",
    tieneVariantes: false,
    variantes: [
      {
        nombre: "Único",
        ean12: "779000300002",
        precioCosto: "12000.00",
        precioVenta: "21990.00",
        stockMinimo: 2,
        stock: [6, 0],
      },
    ],
  },
];

/** Un mismo vape que llega de otro importador con otro código. */
const CODIGOS_ALTERNATIVOS = [
  {
    producto: "Ignite V80",
    variante: "Mango Ice",
    ean12: "779999900001",
    descripcion: "Lote importador B",
  },
];

async function seedUsuarios() {
  const passwordHash = await bcrypt.hash(PASSWORD_INICIAL, 12);
  const usuarios = [
    { email: "dueno1@negocio.com", nombre: "Dueño 1", rol: RolUsuario.OWNER },
    { email: "dueno2@negocio.com", nombre: "Dueño 2", rol: RolUsuario.OWNER },
    { email: "empleado@negocio.com", nombre: "Empleado", rol: RolUsuario.EMPLEADO },
  ];

  const creados = [];
  for (const u of usuarios) {
    // update vacío: re-correr el seed no pisa contraseñas ya cambiadas.
    creados.push(
      await prisma.usuario.upsert({
        where: { email: u.email },
        update: {},
        // La password del seed es conocida: se obliga a cambiarla al primer ingreso.
        create: { ...u, passwordHash, debeCambiarPassword: true },
      }),
    );
  }

  const empleado = creados.find((u) => u.rol === RolUsuario.EMPLEADO);
  if (!empleado) throw new Error("Falta el empleado");
  for (const modulo of [Modulo.VENTAS, Modulo.INVENTARIO]) {
    await prisma.permisoUsuario.upsert({
      where: { usuarioId_modulo: { usuarioId: empleado.id, modulo } },
      update: {},
      create: { usuarioId: empleado.id, modulo, puedeVer: true, puedeCrear: true },
    });
  }

  const owner = creados.find((u) => u.rol === RolUsuario.OWNER);
  if (!owner) throw new Error("Falta un owner");
  return { owner };
}

async function seedDepositos() {
  const galpon1 = await prisma.deposito.upsert({
    where: { nombre: "Galpón 1" },
    update: {},
    create: { nombre: "Galpón 1", esPrincipal: true },
  });
  const galpon2 = await prisma.deposito.upsert({
    where: { nombre: "Galpón 2" },
    update: {},
    create: { nombre: "Galpón 2", esPrincipal: false },
  });
  return [galpon1, galpon2] as const;
}

async function seedCatalogoBase() {
  const categorias = new Map<string, string>();
  for (const [nombre, descripcion] of [
    ["Vapes", "Vapes descartables y recargables"],
    ["Pods", "Pods y cartuchos de repuesto"],
    ["Líquidos", "Líquidos y sales de nicotina"],
    ["Accesorios", "Cargadores, cables, fundas"],
    ["Artefactos", "Artefactos electrónicos"],
  ] as const) {
    const c = await prisma.categoria.upsert({
      where: { nombre },
      update: {},
      create: { nombre, descripcion },
    });
    categorias.set(nombre, c.id);
  }

  const marcas = new Map<string, string>();
  for (const nombre of ["Ignite", "Elf Bar", "TechPro"]) {
    const m = await prisma.marca.upsert({ where: { nombre }, update: {}, create: { nombre } });
    marcas.set(nombre, m.id);
  }
  return { categorias, marcas };
}

async function seedProductos(
  refs: Awaited<ReturnType<typeof seedCatalogoBase>>,
  depositos: readonly [{ id: string }, { id: string }],
  usuarioId: string,
) {
  for (const p of PRODUCTOS) {
    const categoriaId = refs.categorias.get(p.categoria);
    const marcaId = refs.marcas.get(p.marca);
    if (!categoriaId || !marcaId) throw new Error(`Referencias faltantes para ${p.nombre}`);

    // Producto + variantes + stock inicial en UNA transacción: la DB verifica
    // al COMMIT que todo producto tenga sus variantes (constraint diferida).
    await withTransaction(async (tx) => {
      const producto = await tx.producto.upsert({
        where: { nombre_marcaId: { nombre: p.nombre, marcaId } },
        update: {},
        create: {
          nombre: p.nombre,
          descripcion: p.descripcion,
          categoriaId,
          marcaId,
          tieneVariantes: p.tieneVariantes,
        },
      });

      for (const v of p.variantes) {
        const existente = await tx.variante.findUnique({
          where: { productoId_nombre: { productoId: producto.id, nombre: v.nombre } },
        });
        const variante =
          existente ??
          (await tx.variante.create({
            data: {
              productoId: producto.id,
              nombre: v.nombre,
              sku: await generarSku(tx),
              codigoBarras: v.ean12 ? generarEan13(v.ean12) : null,
              precioCosto: v.precioCosto,
              precioVenta: v.precioVenta,
              stockMinimo: v.stockMinimo,
            },
          }));

        // Stock inicial: solo por ledger, y solo una vez por (variante, depósito).
        for (const [i, deposito] of depositos.entries()) {
          const cantidad = v.stock[i] ?? 0;
          if (cantidad <= 0) continue;
          const yaCargado = await tx.movimientoStock.findFirst({
            where: {
              varianteId: variante.id,
              depositoId: deposito.id,
              tipo: TipoMovimiento.INGRESO_MANUAL,
              motivo: MOTIVO_STOCK_INICIAL,
            },
            select: { id: true },
          });
          if (yaCargado) continue;
          await registrarMovimiento(tx, {
            tipo: TipoMovimiento.INGRESO_MANUAL,
            varianteId: variante.id,
            depositoId: deposito.id,
            cantidad,
            costoUnitario: v.precioCosto,
            motivo: MOTIVO_STOCK_INICIAL,
            usuarioId,
          });
        }
      }
    });
  }

  for (const alt of CODIGOS_ALTERNATIVOS) {
    const variante = await prisma.variante.findFirst({
      where: { nombre: alt.variante, producto: { nombre: alt.producto } },
      select: { id: true },
    });
    if (!variante) throw new Error(`No existe ${alt.producto} - ${alt.variante}`);
    const codigo = generarEan13(alt.ean12);
    await prisma.codigoBarrasAlternativo.upsert({
      where: { codigo },
      update: {},
      create: { varianteId: variante.id, codigo, descripcion: alt.descripcion },
    });
  }
}

async function seedConfiguracion() {
  for (const [clave, valor] of Object.entries(CONFIGURACION)) {
    await prisma.configuracion.upsert({ where: { clave }, update: {}, create: { clave, valor } });
  }
  for (const tipo of Object.values(TipoComprobante)) {
    await prisma.secuenciaComprobante.upsert({
      where: { tipo_puntoVenta: { tipo, puntoVenta: 1 } },
      update: {},
      create: { tipo, puntoVenta: 1, ultimoNumero: 0 },
    });
  }
}

async function main() {
  // La configuración va primero: generarSku() lee el prefijo de ahí.
  await seedConfiguracion();
  const { owner } = await seedUsuarios();
  const depositos = await seedDepositos();
  const refs = await seedCatalogoBase();
  await seedProductos(refs, depositos, owner.id);

  const [usuarios, variantes, movimientos, stockTotal] = await Promise.all([
    prisma.usuario.count(),
    prisma.variante.count(),
    prisma.movimientoStock.count(),
    prisma.stock.aggregate({ _sum: { cantidad: true } }),
  ]);
  console.log(
    `Seed OK → usuarios: ${usuarios}, depósitos: ${depositos.length}, variantes: ${variantes}, ` +
      `movimientos: ${movimientos}, unidades en stock: ${stockTotal._sum.cantidad ?? 0}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
