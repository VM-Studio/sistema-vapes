/**
 * Errores de la aplicación. Los que extienden AppError son "esperados": su
 * mensaje está pensado para mostrarse al usuario tal cual y actionHandler()
 * los devuelve como { ok: false, error }. Cualquier otro error es inesperado:
 * se loguea y al cliente le llega un mensaje genérico.
 */

export type CamposConError = Record<string, string[]>;

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = "APP_ERROR",
    public readonly status: number = 400,
    public readonly fields?: CamposConError,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Sin sesión válida. */
export class UnauthorizedError extends AppError {
  constructor(message = "Tenés que iniciar sesión") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

/** Con sesión, pero sin permiso para esta acción. */
export class ForbiddenError extends AppError {
  constructor(message = "No tenés permiso para realizar esta acción") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

/** Datos de entrada inválidos, con detalle por campo. */
export class ValidationError extends AppError {
  constructor(message = "Revisá los datos ingresados", fields?: CamposConError) {
    super(message, "VALIDATION_ERROR", 400, fields);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, fields?: CamposConError) {
    super(message, "CONFLICT", 409, fields);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string,
    public readonly reintentarEnSegundos: number,
  ) {
    super(message, "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}

/** Regla de negocio violada (ej: "stock insuficiente", "debe quedar un dueño"). */
export class DomainError extends AppError {
  constructor(message: string, code = "DOMAIN_ERROR", status = 422, fields?: CamposConError) {
    super(message, code, status, fields);
    this.name = "DomainError";
  }
}

export class StockInsuficienteError extends DomainError {
  constructor(
    public readonly variante: string,
    public readonly deposito: string,
    public readonly disponible: number,
    public readonly solicitado: number,
  ) {
    super(
      `Stock insuficiente de ${variante} en ${deposito}: hay ${disponible}, se piden ${solicitado}`,
      "STOCK_INSUFICIENTE",
      409,
    );
    this.name = "StockInsuficienteError";
  }
}
