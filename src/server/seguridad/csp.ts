/**
 * Content-Security-Policy estricta con nonce (uno por request). Next 15 lee
 * el nonce del header CSP del request y lo pone en sus propios <script>;
 * 'strict-dynamic' deja que esos scripts carguen los chunks del build.
 * Sin 'unsafe-inline' para scripts. Los estilos inline sí se permiten (los
 * usan Next y los gráficos; no ejecutan código).
 */
export interface OpcionesCsp {
  nonce: string;
  dev: boolean;
  /** Orígenes del storage (R2 público y endpoint S3 para URLs firmadas). */
  storage: string[];
  /** Ingesta de Sentry, si está configurado. */
  sentry?: string | null;
  /** La app corre sobre https (NEXT_PUBLIC_APP_URL): se fuerza https en todo. */
  https?: boolean;
}

const origen = (url: string | undefined | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export function construirCsp(o: OpcionesCsp): string {
  const storage = o.storage.map(origen).filter((x): x is string => Boolean(x));
  const sentry = origen(o.sentry ? o.sentry.replace(/\/\/[^@]*@/, "//") : null);
  const directivas: Record<string, string[]> = {
    "default-src": ["'self'"],
    // En dev, React Refresh usa eval.
    "script-src": [
      "'self'",
      `'nonce-${o.nonce}'`,
      "'strict-dynamic'",
      ...(o.dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // blob: → cámara (capturas del escáner) y vistas previas de fotos; data: → íconos inline.
    "img-src": ["'self'", "data:", "blob:", ...storage],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      ...storage,
      ...(sentry ? [sentry] : []),
      ...(o.dev ? ["ws:", "wss:"] : []),
    ],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": ["'self'", "blob:"],
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };
  const csp = Object.entries(directivas).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!o.dev && o.https) csp.push("upgrade-insecure-requests");
  return csp.join("; ");
}
