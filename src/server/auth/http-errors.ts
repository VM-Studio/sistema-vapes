import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { mapearError } from "@/server/action-handler";
import { AppError, RateLimitError } from "@/server/errors";

/** Convierte cualquier error en una respuesta JSON con el mismo formato que las Server Actions. */
export function mapearErrorHttp(error: unknown): NextResponse {
  const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 500;
  const res = NextResponse.json({ ok: false, error: mapearError(error) }, { status });
  if (error instanceof RateLimitError)
    res.headers.set("Retry-After", String(error.reintentarEnSegundos));
  return res;
}
