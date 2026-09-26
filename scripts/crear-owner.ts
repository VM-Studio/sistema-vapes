/**
 * pnpm crear-owner — primer dueño en una base nueva (producción).
 * Pide nombre, email y contraseña por consola (la contraseña no se muestra).
 * Si ya hay un dueño activo, no hace nada: los demás usuarios se crean desde /usuarios.
 */
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { AccionAuditoria, RolUsuario } from "@prisma/client";

import { prisma } from "../src/lib/db";
import { email as emailSchema, texto } from "../src/lib/validations/common";
import { password as passwordSchema } from "../src/lib/validations/usuario";
import { esPasswordComun, hashPassword } from "../src/server/auth/password";

async function preguntar(texto: string, oculto = false): Promise<string> {
  let silenciar = false;
  const salida = new Writable({
    write(chunk, enc, cb) {
      if (!silenciar) process.stdout.write(chunk, enc);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: salida, terminal: true });
  const p = rl.question(texto);
  silenciar = oculto;
  const r = await p;
  rl.close();
  if (oculto) process.stdout.write("\n");
  return r.trim();
}

async function main() {
  const existentes = await prisma.usuario.count({
    where: { rol: RolUsuario.OWNER, activo: true, deletedAt: null },
  });
  if (existentes > 0) {
    console.log(
      `Ya hay ${existentes} dueño(s) activo(s): creá los demás usuarios desde /usuarios.`,
    );
    return;
  }
  const nombre = texto(100).parse(await preguntar("Nombre: "));
  const email = emailSchema.parse(await preguntar("Email: "));
  const pass = await preguntar("Contraseña (mín. 8, letras y números): ", true);
  const r = passwordSchema.safeParse(pass);
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join(" · "));
  if (esPasswordComun(pass)) throw new Error("Esa contraseña es de las más usadas: elegí otra.");
  if ((await preguntar("Repetí la contraseña: ", true)) !== pass)
    throw new Error("Las contraseñas no coinciden.");
  const u = await prisma.usuario.create({
    data: {
      nombre,
      email,
      rol: RolUsuario.OWNER,
      passwordHash: await hashPassword(pass),
      debeCambiarPassword: false,
    },
  });
  await prisma.auditLog.create({
    data: {
      usuarioId: u.id,
      accion: AccionAuditoria.CREATE,
      entidad: "Usuario",
      entidadId: u.id,
      datosDespues: { nombre, email, rol: "OWNER", origen: "crear-owner" },
    },
  });
  console.log(`✔ Dueño creado: ${nombre} <${email}>. Ya podés ingresar.`);
}

main()
  .catch((e: unknown) => {
    console.error(`✘ ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
