-- AlterTable
ALTER TABLE "User" ADD COLUMN "resetPasswordToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetPasswordTokenExpiresAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "verificationTokenExpiresAt" DATETIME;
