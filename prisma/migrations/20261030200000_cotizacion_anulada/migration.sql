-- Cotización anulada a mano: nuevo estado final (el motivo, si lo hay, va en "motivoRechazo").
ALTER TYPE "EstadoCotizacion" ADD VALUE IF NOT EXISTS 'ANULADA';
