-- Catálogo de sedes por organización + sede asignada al especialista.
-- (officeLocation se agregó en la migración previa de esta sesión y no tiene datos.)

-- DropColumn
ALTER TABLE "Specialist" DROP COLUMN "officeLocation";

-- AlterTable
ALTER TABLE "Specialist" ADD COLUMN "locationId" TEXT;

-- CreateTable
CREATE TABLE "OrgLocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgLocation_organizationId_active_idx" ON "OrgLocation"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "Specialist" ADD CONSTRAINT "Specialist_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "OrgLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgLocation" ADD CONSTRAINT "OrgLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
