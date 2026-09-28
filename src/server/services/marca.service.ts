import type { ActualizarMarca, CrearMarca } from "@/lib/validations/clasificacion";
import type { Ctx } from "@/server/db/panel-scoped";

import {
  actualizarClasificacion,
  cambiarActivoClasificacion,
  crearClasificacion,
  listarClasificaciones,
  listarClasificacionesActivas,
} from "./clasificacion.service";

type CtxPanel = Pick<Ctx, "panelId">;

export const listarMarcas = (ctx: CtxPanel) => listarClasificaciones(ctx, "Marca");
export const listarMarcasActivas = (ctx: CtxPanel) => listarClasificacionesActivas(ctx, "Marca");
export const crearMarca = (ctx: Ctx, input: CrearMarca) => crearClasificacion(ctx, "Marca", input);
export const actualizarMarca = (ctx: Ctx, input: ActualizarMarca) =>
  actualizarClasificacion(ctx, "Marca", input);
export const cambiarActivoMarca = (ctx: Ctx, id: string, activo: boolean) =>
  cambiarActivoClasificacion(ctx, "Marca", id, activo);
