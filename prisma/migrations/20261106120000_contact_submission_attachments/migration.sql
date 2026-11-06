-- Los adjuntos de la solicitud pasan de temporales a permanentes y privados.
ALTER TABLE "ContactSubmission" RENAME COLUMN "photoDomicilio" TO "proofOfAddress";

-- Lock de envío: evita que el envío en segundo plano y el botón del panel
-- manden la misma solicitud dos veces.
ALTER TABLE "ContactSubmission"
  ADD COLUMN "frontDniProof" TEXT,
  ADD COLUMN "backDniProof" TEXT,
  ADD COLUMN "wisphubSendingAt" TIMESTAMP(3);
