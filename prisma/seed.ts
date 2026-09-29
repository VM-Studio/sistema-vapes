/**
 * Seed idempotente: correrlo N veces deja la DB en el mismo estado.
 * Solo la estructura para arrancar, SIN datos de negocio (ni productos, ni
 * marcas, ni categorías, ni proveedores, ni clientes, ni ventas):
 * - Paneles Vapes, Cosmetic y Especiales (con su logo), sus depósitos
 *   (Vapes: Ayres Plaza y Mercedes; Cosmetic y Especiales: Principal) y las
 *   secuencias de numeración (VENTA, COMPRA, TRANSFERENCIA, DEVOLUCION,
 *   COTIZACION). La migración de la reforma ya crea casi todo; acá se completa
 *   lo que falte.
 * - Configuración global y por panel con los valores por defecto.
 * - Usuarios definitivos: dueños Juan Cruz y Agustina, empleada Trinidad
 *   (solo Vapes). Emails y contraseñas iniciales vienen del entorno
 *   (SEED_OWNER1_EMAIL / SEED_OWNER1_PASSWORD, SEED_OWNER2_*, SEED_EMPLEADO1_*),
 *   con cambio obligatorio al primer ingreso.
 *
 * Los datos de ejemplo para tests viven en e2e/fixtures/ (no en el seed).
 */
import { Modulo, Prisma, RolUsuario } from "@prisma/client";
import bcrypt from "bcryptjs";

import { CONFIG_ESCANER_DEFAULT } from "../src/features/scanner/config";
import { prisma } from "../src/lib/db";
import { normalizarPermiso, type PermisoModulo } from "../src/lib/permisos";
import { configCotizacionSchema } from "../src/lib/validations/cotizacion";
import { configVentasSchema } from "../src/lib/validations/venta";
import { dbPara } from "../src/server/db/panel-scoped";

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
    cotizacion: configCotizacionSchema.parse({}) as Prisma.InputJsonValue,
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
// Paneles, depósitos y secuencias
// -----------------------------------------------------------------------------

interface PanelSeed {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string;
  etiquetaEspecificacion: string;
  etiquetaUnidades?: string;
  orden: number;
  depositos: { nombre: string; esPrincipal: boolean; id?: string }[];
}

const PANELES: PanelSeed[] = [
  {
    id: PANEL_VAPES,
    nombre: "Vapes",
    slug: "vapes",
    logoUrl: "/logoVape.png",
    etiquetaEspecificacion: "Pitadas",
    etiquetaUnidades: "Vapes vendidos",
    orden: 1,
    depositos: [
      { nombre: "Ayres Plaza", esPrincipal: true },
      { nombre: "Mercedes", esPrincipal: false },
    ],
  },
  {
    id: "pnl_cosmetic",
    nombre: "Cosmetic",
    slug: "cosmetic",
    logoUrl: "/logoCosmetics.png",
    etiquetaEspecificacion: "Contenido",
    orden: 2,
    depositos: [{ nombre: "Principal", esPrincipal: true, id: "dep_cosmetic_principal" }],
  },
  {
    id: "pnl_especiales",
    nombre: "Especiales",
    slug: "especiales",
    logoUrl: "/logoEspecial.png",
    etiquetaEspecificacion: "Detalle",
    orden: 3,
    depositos: [{ nombre: "Principal", esPrincipal: true, id: "dep_especiales_principal" }],
  },
];

/** Numeración correlativa por panel: arranca en 0 (el primer documento es el 1). */
const ENTIDADES_SECUENCIA = ["VENTA", "COMPRA", "TRANSFERENCIA", "DEVOLUCION", "COTIZACION"];

/** Logos estáticos de /public: un logo subido desde la app (storage) no se pisa. */
const esLogoEstatico = (url: string | null) => url == null || /^\/logo[\w-]*\.png$/.test(url);

async function seedPaneles() {
  for (const p of PANELES) {
    const actual = await prisma.panel.findUnique({
      where: { id: p.id },
      select: { logoUrl: true },
    });
    if (actual) {
      if (esLogoEstatico(actual.logoUrl) && actual.logoUrl !== p.logoUrl) {
        await prisma.panel.update({ where: { id: p.id }, data: { logoUrl: p.logoUrl } });
      }
    } else {
      await prisma.panel.create({
        data: {
          id: p.id,
          nombre: p.nombre,
          slug: p.slug,
          logoUrl: p.logoUrl,
          etiquetaEspecificacion: p.etiquetaEspecificacion,
          etiquetaUnidades: p.etiquetaUnidades,
          orden: p.orden,
        },
      });
    }
    for (const d of p.depositos) {
      await prisma.deposito.upsert({
        where: { panelId_nombre: { panelId: p.id, nombre: d.nombre } },
        update: {},
        create: { id: d.id, panelId: p.id, nombre: d.nombre, esPrincipal: d.esPrincipal },
      });
    }
    for (const entidad of ENTIDADES_SECUENCIA) {
      await prisma.secuencia.upsert({
        where: { panelId_entidad: { panelId: p.id, entidad } },
        update: {},
        create: { id: `sec_${p.id}_${entidad.toLowerCase()}`, panelId: p.id, entidad },
      });
    }
  }
}

async function main() {
  // Paneles primero: la configuración por panel y los accesos de Trinidad los necesitan.
  await seedPaneles();
  await seedConfiguracion();
  await seedUsuarios();

  const [paneles, depositos, usuarios] = await Promise.all([
    prisma.panel.count({ where: { activo: true } }),
    prisma.deposito.count(),
    prisma.usuario.count(),
  ]);
  console.log(`Seed OK → paneles: ${paneles}, depósitos: ${depositos}, usuarios: ${usuarios}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
