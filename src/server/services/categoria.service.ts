import type { ActualizarCategoria, CrearCategoria } from "@/lib/validations/clasificacion";
import type { Ctx } from "@/server/db/panel-scoped";

import {
  actualizarClasificacion,
  cambiarActivoClasificacion,
  crearClasificacion,
  listarClasificaciones,
  listarClasificacionesActivas,
} from "./clasificacion.service";

type CtxPanel = Pick<Ctx, "panelId">;

export const listarCategorias = (ctx: CtxPanel) => listarClasificaciones(ctx, "Categoria");
export const listarCategoriasActivas = (ctx: CtxPanel) =>
  listarClasificacionesActivas(ctx, "Categoria");
export const crearCategoria = (ctx: Ctx, input: CrearCategoria) =>
  crearClasificacion(ctx, "Categoria", input);
export const actualizarCategoria = (ctx: Ctx, input: ActualizarCategoria) =>
  actualizarClasificacion(ctx, "Categoria", input);
export const cambiarActivoCategoria = (ctx: Ctx, id: string, activo: boolean) =>
  cambiarActivoClasificacion(ctx, "Categoria", id, activo);
