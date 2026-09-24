import { prisma } from "@/lib/db";

export interface HealthStatus {
  ok: true;
  db: "connected";
  depositos: number;
  variantes: number;
}

export async function getHealth(): Promise<HealthStatus> {
  const [depositos, variantes] = await Promise.all([
    prisma.deposito.count({ where: { activo: true } }),
    prisma.variante.count({ where: { deletedAt: null } }),
  ]);
  return { ok: true, db: "connected", depositos, variantes };
}
