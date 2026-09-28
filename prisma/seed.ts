/**
 * Seed idempotente: correrlo N veces deja la DB en el mismo estado.
 * - Paneles (Vapes, Cosmetic, Especiales), sus depósitos y secuencias ya los
 *   crea la migración de la reforma; acá se completan los de Vapes si faltan.
 * - Usuarios definitivos: dueños Juan Cruz y Agustina, empleada Trinidad
 *   (solo Vapes). Emails y contraseñas iniciales vienen del entorno
 *   (SEED_OWNER1_EMAIL / SEED_OWNER1_PASSWORD, SEED_OWNER2_*, SEED_EMPLEADO1_*),
 *   con cambio obligatorio al primer ingreso.
 * - Catálogo de ejemplo en Vapes (marca + modelo + pitadas, sabores, un sabor
 *   con precio propio, proveedores con su lista de precios); el stock inicial entra SOLO por
 *   registrarMovimiento (INGRESO_MANUAL), una vez por (variante, depósito).
 * - Todo lo de negocio pasa por dbPara(panelId): el panel se inyecta solo.
 */
import { randomBytes } from "node:crypto";

import { Modulo, Moneda, Prisma, RolUsuario, TipoMovimiento } from "@prisma/client";
import bcrypt from "bcryptjs";

import { CONFIG_ESCANER_DEFAULT } from "../src/features/scanner/config";
import { generarEan13 } from "../src/lib/barcode";
import { prisma } from "../src/lib/db";
import { normalizarPermiso, type PermisoModulo } from "../src/lib/permisos";
import { normalizarTelefono } from "../src/lib/validations/cliente";
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

// Catálogo de ejemplo (en Vapes). Producto = marca + modelo + especificación
// ("Pitadas" en Vapes) con UN precio para todos sus sabores; un sabor puede
// tener precio propio. nombreCompleto lo arma la DB (trigger): nunca se escribe.

interface SaborSeed {
  /** El sabor; "Único" para un producto sin sabor. */
  nombre: string;
  /** 12 dígitos base: el verificador EAN-13 se calcula. */
  ean12?: string;
  /** Solo si el sabor tiene un precio distinto al del producto. */
  precioPropio?: string;
  /** Último costo (el de la compra con la que entró el stock inicial). */
  costo: string;
  stockMinimo: number;
  /** Stock inicial por depósito de Vapes: [Ayres Plaza, Mercedes]. */
  stock: [number, number];
}

interface ProductoSeed {
  marca: string;
  modelo: string;
  especificacion: string;
  categoria: string | null;
  precioVenta: string;
  sabores: SaborSeed[];
}

// 779 = prefijo GS1 Argentina; el resto es ficticio.
const PRODUCTOS: ProductoSeed[] = [
  {
    marca: "Ignite",
    modelo: "V80",
    especificacion: "8000",
    categoria: "Vapes",
    precioVenta: "16000.00",
    sabores: [
      {
        nombre: "Mango Ice",
        ean12: "779000100001",
        costo: "9500.00",
        stockMinimo: 10,
        stock: [24, 12],
      },
      {
        nombre: "Strawberry Watermelon",
        ean12: "779000100002",
        costo: "9500.00",
        stockMinimo: 10,
        stock: [18, 6],
      },
      {
        nombre: "Blue Razz Ice",
        ean12: "779000100003",
        precioPropio: "16500.00",
        costo: "9800.00",
        stockMinimo: 10,
        stock: [30, 10],
      },
      {
        nombre: "Grape Ice",
        ean12: "779000100004",
        costo: "9500.00",
        stockMinimo: 10,
        stock: [4, 2],
      },
    ],
  },
  {
    marca: "Elf Bar",
    modelo: "BC",
    especificacion: "5000",
    categoria: "Vapes",
    precioVenta: "14500.00",
    sabores: [
      {
        nombre: "Watermelon Ice",
        ean12: "779000200001",
        costo: "8200.00",
        stockMinimo: 8,
        stock: [20, 10],
      },
      {
        nombre: "Peach Mango",
        ean12: "779000200002",
        costo: "8200.00",
        stockMinimo: 8,
        stock: [15, 5],
      },
      {
        nombre: "Cool Mint",
        ean12: "779000200003",
        costo: "8200.00",
        stockMinimo: 8,
        stock: [12, 12],
      },
      {
        nombre: "Lemon Mint",
        ean12: "779000200004",
        costo: "8200.00",
        stockMinimo: 8,
        stock: [0, 3],
      },
    ],
  },
  {
    marca: "Elf Bar",
    modelo: "BC",
    especificacion: "10000",
    categoria: "Vapes",
    precioVenta: "19000.00",
    sabores: [
      {
        nombre: "Watermelon Ice",
        ean12: "779000200011",
        costo: "11000.00",
        stockMinimo: 5,
        stock: [10, 4],
      },
      {
        nombre: "Blue Razz Ice",
        ean12: "779000200012",
        costo: "11000.00",
        stockMinimo: 5,
        stock: [8, 0],
      },
    ],
  },
  {
    marca: "TechPro",
    modelo: "Cargador USB-C 20W",
    especificacion: "",
    categoria: "Accesorios",
    precioVenta: "8900.00",
    sabores: [
      { nombre: "Único", ean12: "779000300001", costo: "4500.00", stockMinimo: 5, stock: [15, 5] },
    ],
  },
  {
    marca: "TechPro",
    modelo: "Parlante Bluetooth Mini",
    especificacion: "",
    categoria: "Artefactos",
    precioVenta: "21990.00",
    sabores: [
      { nombre: "Único", ean12: "779000300002", costo: "12000.00", stockMinimo: 2, stock: [6, 0] },
    ],
  },
];

const clave = (p: { marca: string; modelo: string; especificacion: string }) =>
  `${p.marca}|${p.modelo}|${p.especificacion}`;

/** Un mismo vape que llega de otro importador con otro código. */
const CODIGOS_ALTERNATIVOS = [
  {
    producto: { marca: "Ignite", modelo: "V80", especificacion: "8000" },
    sabor: "Mango Ice",
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

/** Devuelve el id de cada producto sembrado, por marca|modelo|especificación. */
async function seedProductos(
  refs: Awaited<ReturnType<typeof seedCatalogoBase>>,
  depositos: readonly [{ id: string }, { id: string }],
  usuarioId: string,
): Promise<Map<string, string>> {
  const ctx = { panelId: PANEL_VAPES, usuarioId };
  const ids = new Map<string, string>();
  for (const p of PRODUCTOS) {
    const marcaId = refs.marcas.get(p.marca);
    const categoriaId = p.categoria ? refs.categorias.get(p.categoria) : null;
    if (!marcaId || categoriaId === undefined)
      throw new Error(`Referencias faltantes para ${clave(p)}`);

    // Producto + sabores + stock inicial en UNA transacción: la DB verifica
    // al COMMIT que todo producto tenga sus variantes (constraint diferida).
    const productoId = await transaccion(
      ctx,
      async (tx) => {
        const producto =
          (await tx.producto.findFirst({
            where: { marcaId, nombre: p.modelo, especificacion: p.especificacion },
            select: { id: true },
          })) ??
          (await tx.producto.create({
            data: {
              marcaId,
              nombre: p.modelo,
              especificacion: p.especificacion,
              categoriaId,
              precioVenta: p.precioVenta,
            },
            select: { id: true },
          }));
        for (const s of p.sabores) {
          const variante =
            (await tx.variante.findUnique({
              where: {
                panelId_productoId_nombre: {
                  panelId: PANEL_VAPES,
                  productoId: producto.id,
                  nombre: s.nombre,
                },
              },
            })) ??
            (await tx.variante.create({
              data: {
                productoId: producto.id,
                nombre: s.nombre,
                sku: skuNuevo(),
                codigoBarras: s.ean12 ? generarEan13(s.ean12) : null,
                precioVenta: s.precioPropio ?? null,
                ultimoCosto: s.costo,
                stockMinimo: s.stockMinimo,
              },
            }));
          for (const [i, deposito] of depositos.entries()) {
            const cantidad = s.stock[i] ?? 0;
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
              costoUnitario: s.costo,
              motivo: MOTIVO_STOCK_INICIAL,
              usuarioId,
            });
          }
        }
        return producto.id;
      },
      { timeout: 60_000 },
    );
    ids.set(clave(p), productoId);
  }

  const db = dbPara(PANEL_VAPES);
  for (const alt of CODIGOS_ALTERNATIVOS) {
    const productoId = ids.get(clave(alt.producto));
    const variante = productoId
      ? await db.variante.findFirst({
          where: { productoId, nombre: alt.sabor },
          select: { id: true },
        })
      : null;
    if (!variante) throw new Error(`No existe ${clave(alt.producto)} - ${alt.sabor}`);
    const codigo = generarEan13(alt.ean12);
    await db.codigoBarrasAlternativo.upsert({
      where: { panelId_codigo: { panelId: PANEL_VAPES, codigo } },
      update: {},
      create: { varianteId: variante.id, codigo, descripcion: alt.descripcion },
    });
  }
  return ids;
}

// Proveedores: contacto, tienda y teléfono (normalizado +54), con la lista de
// precios de cada uno por producto (ignora el sabor).

interface ProveedorSeed {
  nombre: string;
  nombreTienda: string;
  telefono: string;
  notas?: string;
  precios: { producto: string; precio: string; moneda: Moneda }[];
}

const PROVEEDORES: ProveedorSeed[] = [
  {
    nombre: "Lucas Fernández",
    nombreTienda: "Distribuidora Ejemplo",
    telefono: "11 5555-0000",
    notas: "Entrega martes y viernes",
    precios: [
      { producto: "Ignite|V80|8000", precio: "9500.00", moneda: Moneda.ARS },
      { producto: "Elf Bar|BC|5000", precio: "8200.00", moneda: Moneda.ARS },
      { producto: "TechPro|Cargador USB-C 20W|", precio: "4500.00", moneda: Moneda.ARS },
    ],
  },
  {
    nombre: "Sofía Ríos",
    nombreTienda: "Vape Import Once",
    telefono: "11 5555-0001",
    precios: [
      { producto: "Ignite|V80|8000", precio: "9300.00", moneda: Moneda.ARS },
      { producto: "Elf Bar|BC|10000", precio: "9.50", moneda: Moneda.USD },
    ],
  },
];

async function seedProveedores(productos: Map<string, string>, usuarioId: string) {
  const db = dbPara(PANEL_VAPES);
  for (const p of PROVEEDORES) {
    const telefono = normalizarTelefono(p.telefono);
    const proveedor =
      (await db.proveedor.findFirst({ where: { telefono, deletedAt: null } })) ??
      (await db.proveedor.create({
        data: { nombre: p.nombre, nombreTienda: p.nombreTienda, telefono, notas: p.notas ?? null },
      }));
    for (const pr of p.precios) {
      const productoId = productos.get(pr.producto);
      if (!productoId) throw new Error(`No existe el producto ${pr.producto}`);
      await db.proveedorProducto.upsert({
        where: {
          panelId_proveedorId_productoId: {
            panelId: PANEL_VAPES,
            proveedorId: proveedor.id,
            productoId,
          },
        },
        update: {},
        create: {
          proveedorId: proveedor.id,
          productoId,
          precio: pr.precio,
          moneda: pr.moneda,
          usuarioId,
        },
      });
    }
  }
}

/** Clientes de ejemplo de Vapes: nombre + teléfono (obligatorio y único por panel). */
async function seedClientes() {
  const db = dbPara(PANEL_VAPES);
  const clientes = [
    { nombre: "Martín Gómez", telefono: "11 5555-0101", notas: "Compra por mayor los viernes." },
    { nombre: "Lucía Fernández", telefono: "11 5555-0102", notas: null },
    { nombre: "Nicolás Pereyra", telefono: "221 555-0103", notas: null },
  ];
  for (const c of clientes) {
    const telefono = normalizarTelefono(c.telefono)!;
    if (!(await db.cliente.findFirst({ where: { telefono, deletedAt: null } }))) {
      await db.cliente.create({ data: { nombre: c.nombre, telefono, notas: c.notas } });
    }
  }
}

async function main() {
  // La configuración va primero: el prefijo de SKU y el escáner se leen de ahí.
  await seedConfiguracion();
  const { ownerId } = await seedUsuarios();
  const depositos = await seedDepositosVapes();
  const refs = await seedCatalogoBase();
  const productos = await seedProductos(refs, depositos, ownerId);
  await seedProveedores(productos, ownerId);
  await seedClientes();

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
