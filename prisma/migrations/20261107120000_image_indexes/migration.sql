-- Índices para las búsquedas del seed y la comprobación de uso de imágenes.
CREATE INDEX "ImageAsset_folder_originalName_idx" ON "ImageAsset"("folder", "originalName");
CREATE INDEX "MapLocation_imageId_idx" ON "MapLocation"("imageId");

-- El panel puede quitar la foto de una sede; el seed no debe reasignarla.
ALTER TABLE "MapLocation" ADD COLUMN "imageOptOut" BOOLEAN NOT NULL DEFAULT false;
