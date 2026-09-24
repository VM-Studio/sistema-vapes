import type { ActualizarMarca, CrearMarca } from "@/lib/validations/clasificacion";
import type { Actor } from "@/server/services/actor";

import {
  actualizarClasificacion,
  cambiarActivoClasificacion,
  crearClasificacion,
  listarClasificaciones,
  listarClasificacionesActivas,
} from "./clasificacion.service";

export const listarMarcas = () => listarClasificaciones("Marca");
export const listarMarcasActivas = () => listarClasificacionesActivas("Marca");
export const crearMarca = (input: CrearMarca, actor: Actor) =>
  crearClasificacion("Marca", input, actor);
export const actualizarMarca = (input: ActualizarMarca, actor: Actor) =>
  actualizarClasificacion("Marca", input, actor);
export const cambiarActivoMarca = (id: string, activo: boolean, actor: Actor) =>
  cambiarActivoClasificacion("Marca", id, activo, actor);
