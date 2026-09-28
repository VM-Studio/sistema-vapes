"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { id } from "@/lib/validations/common";
import { actionHandler } from "@/server/action-handler";
import { requireOwner } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { hacerBackup, urlDescargaBackup } from "@/server/services/backup.service";

export const backupAhoraAction = actionHandler(async () => {
  await requireOwner();
  const r = await hacerBackup("manual");
  revalidatePath("/configuracion/backups");
  return r;
});

export const descargarBackupAction = actionHandler(async (input: unknown) => {
  await requireOwner();
  const url = await urlDescargaBackup(z.object({ id }).parse(input).id);
  if (!url) throw new NotFoundError("Ese backup ya no está (se rotó) o falló.");
  return { url };
});
