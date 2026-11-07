/**
 * Producción (v2.8.1): a Trinidad, en el panel Vapes, le saca PROVEEDORES y le
 * da COMPRAS solo «ver» (sin precios: como tiene ganancia por vape, Compras le
 * oculta los costos). Mismo mecanismo que la pantalla Equipo (actualizarAcceso:
 * UsuarioPanel + grilla PermisoUsuario + AuditLog PERMISO_CAMBIADO). Conserva
 * todo lo demás. Idempotente.
 *
 * Uso (con DATABASE_URL/DIRECT_URL de producción en el entorno):
 *   pnpm tsx --env-file-if-exists=.env --conditions=react-server scripts/_prod-permisos-trinidad-compras.ts [--dry-run]
 */
import { Modulo, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { MODULOS_DE_PANEL } from "../src/lib/permisos";
import { actualizarAccesoSchema } from "../src/lib/validations/usuario";
import { actualizarAcceso, obtenerAcceso } from "../src/server/services/usuario.service";

const EMAIL = "trinidelatorre06@gmail.com";
const SLUG = "vapes";
const DRY = process.argv.includes("--dry-run");

async function main() {
  const usuario = await prisma.usuario.findFirst({
    where: { email: EMAIL, deletedAt: null },
    select: { id: true, nombre: true, rol: true, activo: true },
  });
  if (!usuario) throw new Error(`No existe el usuario ${EMAIL}.`);
  if (usuario.rol !== RolUsuario.EMPLEADO)
    throw new Error(`${EMAIL} no es EMPLEADO (${usuario.rol}): no se le asignan permisos.`);
  const panel = await prisma.panel.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (!panel) throw new Error(`No existe el panel "${SLUG}".`);
  const actor = await prisma.usuario.findFirst({
    where: { rol: RolUsuario.OWNER, activo: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, nombre: true },
  });
  if (!actor) throw new Error("No hay un dueño activo para firmar la auditoría.");

  const antes = await obtenerAcceso(usuario.id);
  const fila = (m: Modulo) => antes.permisos.find((p) => p.panelId === panel.id && p.modulo === m);
  const prov = fila(Modulo.PROVEEDORES);
  const compras = fila(Modulo.COMPRAS);
  const yaEsta =
    antes.paneles.includes(panel.id) &&
    !prov?.puedeVer &&
    compras?.puedeVer &&
    !compras.puedeCrear &&
    !compras.puedeEditar &&
    !compras.puedeEliminar;
  if (yaEsta) {
    console.log(
      `✔ ${usuario.nombre} ya está sin Proveedores y con Compras solo ver: nada que hacer.`,
    );
    return;
  }

  // Grilla completa por panel (lo que no se manda queda apagado en actualizarAcceso).
  const panelIds = [...new Set([...antes.paneles, panel.id])];
  // Mismo schema que la acción de Equipo (normaliza "cualquier acción implica ver").
  const input = actualizarAccesoSchema.parse({
    usuarioId: usuario.id,
    paneles: panelIds.map((panelId) => ({
      panelId,
      permisos: MODULOS_DE_PANEL.map((modulo) => {
        const actual = antes.permisos.find((p) => p.panelId === panelId && p.modulo === modulo);
        const base = {
          modulo,
          puedeVer: actual?.puedeVer ?? false,
          puedeCrear: actual?.puedeCrear ?? false,
          puedeEditar: actual?.puedeEditar ?? false,
          puedeEliminar: actual?.puedeEliminar ?? false,
        };
        if (panelId !== panel.id) return base;
        if (modulo === Modulo.PROVEEDORES)
          return {
            modulo,
            puedeVer: false,
            puedeCrear: false,
            puedeEditar: false,
            puedeEliminar: false,
          };
        if (modulo === Modulo.COMPRAS)
          return {
            modulo,
            puedeVer: true,
            puedeCrear: false,
            puedeEditar: false,
            puedeEliminar: false,
          };
        return base;
      }),
    })),
  });

  const txt = (p?: {
    puedeVer: boolean;
    puedeCrear: boolean;
    puedeEditar: boolean;
    puedeEliminar: boolean;
  }) =>
    p
      ? `ver=${p.puedeVer} crear=${p.puedeCrear} editar=${p.puedeEditar} eliminar=${p.puedeEliminar}`
      : "nada";
  console.log(
    `${DRY ? "[dry-run] " : ""}${usuario.nombre} <${EMAIL}> en ${SLUG}: PROVEEDORES (${txt(prov)}) → nada; ` +
      `COMPRAS (${txt(compras)}) → solo ver (firma ${actor.nombre}).`,
  );
  if (DRY) return;
  const despues = await actualizarAcceso({ id: actor.id }, input);
  const p2 = despues.permisos.find(
    (p) => p.panelId === panel.id && p.modulo === Modulo.PROVEEDORES,
  );
  const c2 = despues.permisos.find((p) => p.panelId === panel.id && p.modulo === Modulo.COMPRAS);
  if (p2?.puedeVer || !c2?.puedeVer || c2.puedeCrear || c2.puedeEditar || c2.puedeEliminar)
    throw new Error("No quedó como se esperaba: revisá la grilla en Equipo.");
  console.log("✔ Listo.");
}

main()
  .catch((e: unknown) => {
    console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
