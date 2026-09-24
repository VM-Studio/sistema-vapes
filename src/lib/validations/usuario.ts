import { Modulo, RolUsuario } from "@prisma/client";
import { z } from "zod";

import { email, id, texto } from "./common";

export const password = z
  .string()
  .min(8, "Mínimo 8 caracteres")
  .max(72, "Máximo 72 caracteres") // límite de bcrypt
  .regex(/[a-z]/, "Debe incluir una minúscula")
  .regex(/[A-Z]/, "Debe incluir una mayúscula")
  .regex(/\d/, "Debe incluir un número");

export const permisoModuloSchema = z.object({
  modulo: z.enum(Modulo),
  puedeVer: z.boolean().default(false),
  puedeCrear: z.boolean().default(false),
  puedeEditar: z.boolean().default(false),
  puedeEliminar: z.boolean().default(false),
});

const permisos = z
  .array(permisoModuloSchema)
  .refine((ps) => new Set(ps.map((p) => p.modulo)).size === ps.length, "Módulo repetido")
  // Cualquier acción sobre un módulo implica poder verlo.
  .transform((ps) =>
    ps.map((p) => ({
      ...p,
      puedeVer: p.puedeVer || p.puedeCrear || p.puedeEditar || p.puedeEliminar,
    })),
  );

export const crearUsuarioSchema = z
  .object({
    nombre: texto(100),
    email,
    password,
    rol: z.enum(RolUsuario),
    activo: z.boolean().default(true),
    permisos: permisos.default([]),
  })
  .transform((u) => (u.rol === RolUsuario.OWNER ? { ...u, permisos: [] } : u)); // OWNER: todo por rol

export const actualizarUsuarioSchema = z.object({
  id,
  nombre: texto(100).optional(),
  email: email.optional(),
  rol: z.enum(RolUsuario).optional(),
  activo: z.boolean().optional(),
});

export const cambiarPasswordSchema = z
  .object({
    passwordActual: z.string().min(1, "Requerido"),
    passwordNueva: password,
  })
  .refine((d) => d.passwordActual !== d.passwordNueva, {
    message: "La nueva contraseña debe ser distinta",
    path: ["passwordNueva"],
  });

export const actualizarPermisosSchema = z.object({
  usuarioId: id,
  permisos,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export type CrearUsuarioInput = z.input<typeof crearUsuarioSchema>;
export type CrearUsuario = z.output<typeof crearUsuarioSchema>;
export type ActualizarUsuario = z.output<typeof actualizarUsuarioSchema>;
export type ActualizarPermisos = z.output<typeof actualizarPermisosSchema>;
export type LoginInput = z.output<typeof loginSchema>;
