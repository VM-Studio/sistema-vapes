import type { ActualizarCategoria, CrearCategoria } from "@/lib/validations/clasificacion";
import type { Actor } from "@/server/services/actor";

import {
  actualizarClasificacion,
  cambiarActivoClasificacion,
  crearClasificacion,
  listarClasificaciones,
  listarClasificacionesActivas,
} from "./clasificacion.service";

export const listarCategorias = () => listarClasificaciones("Categoria");
export const listarCategoriasActivas = () => listarClasificacionesActivas("Categoria");
export const crearCategoria = (input: CrearCategoria, actor: Actor) =>
  crearClasificacion("Categoria", input, actor);
export const actualizarCategoria = (input: ActualizarCategoria, actor: Actor) =>
  actualizarClasificacion("Categoria", input, actor);
export const cambiarActivoCategoria = (id: string, activo: boolean, actor: Actor) =>
  cambiarActivoClasificacion("Categoria", id, activo, actor);
