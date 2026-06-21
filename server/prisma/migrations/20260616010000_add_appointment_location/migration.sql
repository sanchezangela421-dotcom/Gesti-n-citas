-- Ubicación de citas presenciales (aditivo).

-- AlterTable
ALTER TABLE "Specialist" ADD COLUMN "officeLocation" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "location" TEXT;
