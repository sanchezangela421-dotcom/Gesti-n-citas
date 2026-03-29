-- AlterTable: add isFollowUp and parentId to Appointment
ALTER TABLE "Appointment" ADD COLUMN "isFollowUp" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN "parentId" TEXT;

-- CreateIndex for parentId foreign key lookups
CREATE INDEX "Appointment_parentId_idx" ON "Appointment"("parentId");
