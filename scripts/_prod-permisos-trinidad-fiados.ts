/**
 * Producción (v2.10.0): le da a Trinidad FIADOS ver/crear/editar en el panel
 * Vapes: vende fiado («Fiar el resto» al vender), ve TODOS los fiados del
 * panel (los suyos y los de los dueños: lo pidieron los dueños) y registra
 * cobros. Mismo mecanismo que la pantalla Equipo (actualizarAcceso:
 * UsuarioPanel + grilla PermisoUsuario + AuditLog PERMISO_CAMBIADO). Conserva
 * todo lo demás que ya tenga. Idempotente: si ya los tiene, no escribe nada.
 *
 * Uso (con DATABASE_URL/DIRECT_URL de producción en el entorno):
 *   pnpm tsx --env-file-if-exists=.env --conditions=react-server scripts/_prod-permisos-trinidad-fiados.ts [--dry-run]
 *
 * El caché de sesiones del servidor dura hasta 60 s: el cambio se ve al
 * recargar pasado ese tiempo (o si Trinidad vuelve a entrar).
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
  const fiados = antes.permisos.find((p) => p.panelId === panel.id && p.modulo === Modulo.FIADOS);
  const yaTiene =
    antes.paneles.includes(panel.id) && fiados?.puedeVer && fiados.puedeCrear && fiados.puedeEditar;
  if (yaTiene) {
    console.log(`✔ ${usuario.nombre} ya tiene FIADOS ver/crear/editar en ${SLUG}: nada que hacer.`);
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
        return panelId === panel.id && modulo === Modulo.FIADOS
          ? { ...base, puedeVer: true, puedeCrear: true, puedeEditar: true }
          : base;
      }),
    })),
  });

  console.log(
    `${DRY ? "[dry-run] " : ""}${usuario.nombre} <${EMAIL}>: FIADOS en ${SLUG} ` +
      `${fiados ? `ver=${fiados.puedeVer} crear=${fiados.puedeCrear} editar=${fiados.puedeEditar}` : "(sin acceso al panel)"}` +
      ` → ver/crear/editar (firma ${actor.nombre}).`,
  );
  if (DRY) return;
  const despues = await actualizarAcceso({ id: actor.id }, input);
  const v = despues.permisos.find((p) => p.panelId === panel.id && p.modulo === Modulo.FIADOS);
  if (!v?.puedeVer || !v.puedeCrear || !v.puedeEditar)
    throw new Error("No quedó el permiso: revisá la grilla en Equipo.");
  console.log("✔ Listo.");
}

main()
  .catch((e: unknown) => {
    console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
