/** IP y user-agent del request, para AuditLog e IntentoLogin. */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function metaDesdeHeaders(h: Headers): RequestMeta {
  // Detrás de un proxy (Vercel, nginx) la IP real es la primera de x-forwarded-for.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/** Para Server Components / Server Actions. */
export async function getRequestMeta(): Promise<RequestMeta> {
  const { headers } = await import("next/headers");
  return metaDesdeHeaders(await headers());
}
