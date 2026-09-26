import { mapearErrorHttp } from "@/server/auth/http";
import { requireOwner } from "@/server/auth/permissions";
import { NotFoundError } from "@/server/errors";
import { leerBackupLocal } from "@/server/services/backup.service";

export const runtime = "nodejs";

/** Descarga de un backup con storage local (en S3/R2 se usa una URL firmada de 15 min). Solo dueños. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOwner();
    const b = await leerBackupLocal((await params).id);
    if (!b) throw new NotFoundError("El backup no existe o ya se rotó");
    return new Response(Buffer.from(b.datos), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${b.nombre}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return mapearErrorHttp(e);
  }
}
