/**
 * Errores de dominio: mensajes pensados para mostrarse al usuario tal cual.
 * Todo lo que no sea DomainError es un error inesperado (500).
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DOMAIN_ERROR",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
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
