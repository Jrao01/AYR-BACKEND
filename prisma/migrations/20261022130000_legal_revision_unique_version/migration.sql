-- Una revisión por versión y documento: serializa las publicaciones
-- concurrentes (la segunda falla con P2002 y la transacción revierte).
CREATE UNIQUE INDEX "LegalRevision_documentId_version_key" ON "LegalRevision"("documentId", "version");
