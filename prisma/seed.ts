/**
 * Seed idempotente: correrlo N veces deja la DB en el mismo estado.
 * - Paneles (Vapes, Cosmetic, Especiales), sus depósitos y secuencias ya los
 *   crea la migración de la reforma; acá se completan los de Vapes si faltan.
 * - Usuarios definitivos: dueños Juan Cruz y Agustina, empleada Trinidad
 *   (solo Vapes). Emails y contraseñas iniciales vienen del entorno
 *   (SEED_OWNER1_EMAIL / SEED_OWNER1_PASSWORD, SEED_OWNER2_*, SEED_EMPLEADO1_*),
 *   con cambio obligatorio al primer ingreso.
 * - Catálogo de ejemplo en Vapes; el stock inicial entra SOLO por
 *   registrarMovimiento (INGRESO_MANUAL), una vez por (variante, depósito).
 * - Todo lo de negocio pasa por dbPara(panelId): el panel se inyecta solo.
 */
import { randomBytes } from "node:crypto";

import { Modulo, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { CONFIG_ESCANER_DEFAULT } from "../src/features/scanner/config";
import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { normalizarPermiso, type PermisoModulo } from "../src/lib/permisos";
import { configVentasSchema } from "../src/lib/validations/venta";
import { dbPara, transaccion } from "../src/server/db/panel-scoped";
import { registrarMovimiento } from "../src/server/services/stock.service";

/**
 * En producción el seed NO corre salvo ALLOW_SEED=true (crea usuarios con
 * contraseñas iniciales conocidas). El primer dueño también se puede crear
 * con `pnpm crear-owner`.
 */
const PRODUCCION = process.env.NODE_ENV === "production";
if (PRODUCCION && process.env.ALLOW_SEED !== "true") {
  console.error(
    "✘ seed bloqueado en producción (definí ALLOW_SEED=true si de verdad querés sembrar esta base).",
  );
  process.exit(1);
}

const PANEL_VAPES = "pnl_vapes";
const MOTIVO_STOCK_INICIAL = "Stock inicial (seed)";

// -----------------------------------------------------------------------------
// Usuarios
// -----------------------------------------------------------------------------

interface UsuarioSeed {
  nombre: string;
  rol: RolUsuario;
  prefijoEnv: "SEED_OWNER1" | "SEED_OWNER2" | "SEED_EMPLEADO1";
  /** Solo para desarrollo: en producción el email y la contraseña son obligatorios en el entorno. */
  emailDesarrollo: string;
}

const USUARIOS: UsuarioSeed[] = [
  {
    nombre: "Juan Cruz",
    rol: RolUsuario.OWNER,
    prefijoEnv: "SEED_OWNER1",
    emailDesarrollo: "juancruz@negocio.com",
  },
  {
    nombre: "Agustina",
    rol: RolUsuario.OWNER,
    prefijoEnv: "SEED_OWNER2",
    emailDesarrollo: "agustina@negocio.com",
  },
  {
    nombre: "Trinidad",
    rol: RolUsuario.EMPLEADO,
    prefijoEnv: "SEED_EMPLEADO1",
    emailDesarrollo: "trinidad@negocio.com",
  },
];

const PASSWORD_DESARROLLO = "Cambiar123!";

/** Trinidad: solo Vapes; ver/crear en Ventas, Clientes y Cotizador; ver en Productos y Stock. */
const PERMISOS_TRINIDAD: Omit<PermisoModulo, "panelId">[] = [
  {
    modulo: Modulo.VENTAS,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: false,
    puedeEliminar: false,
  },
  {
    modulo: Modulo.CLIENTES,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: false,
    puedeEliminar: false,
  },
  {
    modulo: Modulo.COTIZADOR,
    puedeVer: true,
    puedeCrear: true,
    puedeEditar: false,
    puedeEliminar: false,
  },
  {
    modulo: Modulo.PRODUCTOS,
    puedeVer: true,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  },
  {
    modulo: Modulo.STOCK,
    puedeVer: true,
    puedeCrear: false,
    puedeEditar: false,
    puedeEliminar: false,
  },
];

function credenciales(u: UsuarioSeed): { email: string; password: string } {
  const email = process.env[`${u.prefijoEnv}_EMAIL`]?.trim().toLowerCase();
  const password = process.env[`${u.prefijoEnv}_PASSWORD`];
  if (email && password) return { email, password };
  if (PRODUCCION) {
    throw new Error(
      `Faltan ${u.prefijoEnv}_EMAIL y ${u.prefijoEnv}_PASSWORD (usuario ${u.nombre}).`,
    );
  }
  return { email: email ?? u.emailDesarrollo, password: password ?? PASSWORD_DESARROLLO };
}

async function seedUsuarios(): Promise<{ ownerId: string }> {
  let ownerId: string | null = null;
  for (const u of USUARIOS) {
    const { email, password } = credenciales(u);
    // update vacío: re-correr el seed no pisa contraseñas ya cambiadas.
    const fila = await prisma.usuario.upsert({
      where: { email },
      update: {},
      create: {
        nombre: u.nombre,
        email,
        rol: u.rol,
        passwordHash: await bcrypt.hash(password, 12),
        debeCambiarPassword: true,
      },
    });
    if (u.rol === RolUsuario.OWNER) ownerId ??= fila.id;
    if (u.nombre === "Trinidad") {
      await prisma.usuarioPanel.upsert({
        where: { usuarioId_panelId: { usuarioId: fila.id, panelId: PANEL_VAPES } },
        update: {},
        create: { usuarioId: fila.id, panelId: PANEL_VAPES },
      });
      for (const p of PERMISOS_TRINIDAD) {
        const permiso = normalizarPermiso({ ...p, panelId: PANEL_VAPES });
        const { panelId, modulo, ...acciones } = permiso;
        await prisma.permisoUsuario.upsert({
          where: { usuarioId_panelId_modulo: { usuarioId: fila.id, panelId, modulo } },
          update: {},
          create: { usuarioId: fila.id, panelId, modulo, ...acciones },
        });
      }
    }
  }
  if (!ownerId) throw new Error("Falta un dueño");
  return { ownerId };
}

// -----------------------------------------------------------------------------
// Configuración (global y por panel)
// -----------------------------------------------------------------------------

async function seedConfiguracion() {
  const globales: Record<string, Prisma.InputJsonValue> = { nombreNegocio: "Mi Negocio" };
  for (const [clave, valor] of Object.entries(globales)) {
    await prisma.configuracionGlobal.upsert({
      where: { clave },
      update: {},
      create: { clave, valor },
    });
  }
  const porPanel: Record<string, Prisma.InputJsonValue> = {
    alertaStockMinimo: true,
    prefijoSku: "PRD",
    escaner: { ...CONFIG_ESCANER_DEFAULT, sufijos: [...CONFIG_ESCANER_DEFAULT.sufijos] },
    ventas: configVentasSchema.parse({}) as Prisma.InputJsonValue,
  };
  const paneles = await prisma.panel.findMany({ select: { id: true } });
  for (const { id: panelId } of paneles) {
    const db = dbPara(panelId);
    for (const [clave, valor] of Object.entries(porPanel)) {
      await db.configuracion.upsert({
        where: { panelId_clave: { panelId, clave } },
        update: {},
        create: { clave, valor },
      });
    }
  }
}

// -----------------------------------------------------------------------------
// Vapes: depósitos, catálogo de ejemplo, proveedor y cliente
// -----------------------------------------------------------------------------

async function seedDepositosVapes() {
  const db = dbPara(PANEL_VAPES);
  const ayres = await db.deposito.upsert({
    where: { panelId_nombre: { panelId: PANEL_VAPES, nombre: "Ayres Plaza" } },
    update: {},
    create: { nombre: "Ayres Plaza", esPrincipal: true },
  });
  const mercedes = await db.deposito.upsert({
    where: { panelId_nombre: { panelId: PANEL_VAPES, nombre: "Mercedes" } },
    update: {},
    create: { nombre: "Mercedes", esPrincipal: false },
  });
  return [ayres, mercedes] as const;
}

// Productos de ejemplo (en Vapes).

interface VarianteSeed {
  nombre: string;
  /** 12 dígitos base: el verificador EAN-13 se calcula. */
  ean12?: string;
  precioCosto: string;
  precioVenta: string;
  stockMinimo: number;
  /** Stock inicial por depósito de Vapes: [Ayres Plaza, Mercedes]. */
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

async function seedCatalogoBase() {
  const db = dbPara(PANEL_VAPES);
  const categorias = new Map<string, string>();
  for (const [nombre, descripcion] of [
    ["Vapes", "Vapes descartables y recargables"],
    ["Pods", "Pods y cartuchos de repuesto"],
    ["Líquidos", "Líquidos y sales de nicotina"],
    ["Accesorios", "Cargadores, cables, fundas"],
    ["Artefactos", "Artefactos electrónicos"],
  ] as const) {
    const c = await db.categoria.upsert({
      where: { panelId_nombre: { panelId: PANEL_VAPES, nombre } },
      update: {},
      create: { nombre, descripcion },
    });
    categorias.set(nombre, c.id);
  }
  const marcas = new Map<string, string>();
  for (const nombre of ["Ignite", "Elf Bar", "TechPro"]) {
    const m = await db.marca.upsert({
      where: { panelId_nombre: { panelId: PANEL_VAPES, nombre } },
      update: {},
      create: { nombre },
    });
    marcas.set(nombre, m.id);
  }
  return { categorias, marcas };
}

/** SKU del seed: PRD-XXXXXX (el mismo formato que genera la app). */
const skuNuevo = () => `PRD-${randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;

async function seedProductos(
  refs: Awaited<ReturnType<typeof seedCatalogoBase>>,
  depositos: readonly [{ id: string }, { id: string }],
  usuarioId: string,
) {
  const ctx = { panelId: PANEL_VAPES, usuarioId };
  for (const p of PRODUCTOS) {
    const categoriaId = refs.categorias.get(p.categoria);
    const marcaId = refs.marcas.get(p.marca);
    if (!categoriaId || !marcaId) throw new Error(`Referencias faltantes para ${p.nombre}`);

    // Producto + variantes + stock inicial en UNA transacción: la DB verifica
    // al COMMIT que todo producto tenga sus variantes (constraint diferida).
    await transaccion(
      ctx,
      async (tx) => {
        const producto = await tx.producto.upsert({
          where: { panelId_nombre_marcaId: { panelId: PANEL_VAPES, nombre: p.nombre, marcaId } },
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
          const variante =
            (await tx.variante.findUnique({
              where: { productoId_nombre: { productoId: producto.id, nombre: v.nombre } },
            })) ??
            (await tx.variante.create({
              data: {
                productoId: producto.id,
                nombre: v.nombre,
                sku: skuNuevo(),
                codigoBarras: v.ean12 ? generarEan13(v.ean12) : null,
                precioCosto: v.precioCosto,
                precioVenta: v.precioVenta,
                stockMinimo: v.stockMinimo,
              },
            }));
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
      },
      { timeout: 60_000 },
    );
  }

  const db = dbPara(PANEL_VAPES);
  for (const alt of CODIGOS_ALTERNATIVOS) {
    const variante = await db.variante.findFirst({
      where: { nombre: alt.variante, producto: { nombre: alt.producto } },
      select: { id: true },
    });
    if (!variante) throw new Error(`No existe ${alt.producto} - ${alt.variante}`);
    const codigo = generarEan13(alt.ean12);
    await db.codigoBarrasAlternativo.upsert({
      where: { panelId_codigo: { panelId: PANEL_VAPES, codigo } },
      update: {},
      create: { varianteId: variante.id, codigo, descripcion: alt.descripcion },
    });
  }
}

async function seedProveedorYCliente() {
  const db = dbPara(PANEL_VAPES);
  if (!(await db.proveedor.findFirst({ where: { cuit: "30712345671", deletedAt: null } }))) {
    await db.proveedor.create({
      data: {
        nombre: "Distribuidora Ejemplo SRL",
        cuit: "30712345671",
        telefono: "+541155550000",
        email: "ventas@distribuidora-ejemplo.com.ar",
      },
    });
  }
  if (!(await db.cliente.findFirst({ where: { telefono: "+541155550101", deletedAt: null } }))) {
    await db.cliente.create({
      data: {
        nombre: "Martín",
        apellido: "Gómez",
        documento: "30111222",
        telefono: "+541155550101",
      },
    });
  }
}

async function main() {
  // La configuración va primero: el prefijo de SKU y el escáner se leen de ahí.
  await seedConfiguracion();
  const { ownerId } = await seedUsuarios();
  const depositos = await seedDepositosVapes();
  const refs = await seedCatalogoBase();
  await seedProductos(refs, depositos, ownerId);
  await seedProveedorYCliente();

  const [usuarios, paneles, variantes, movimientos, stockTotal] = await Promise.all([
    prisma.usuario.count(),
    prisma.panel.count({ where: { activo: true } }),
    prisma.variante.count(),
    prisma.movimientoStock.count(),
    prisma.stock.aggregate({ _sum: { cantidad: true } }),
  ]);
  console.log(
    `Seed OK → paneles: ${paneles}, usuarios: ${usuarios}, variantes: ${variantes}, ` +
      `movimientos: ${movimientos}, unidades en stock: ${stockTotal._sum.cantidad ?? 0}`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
