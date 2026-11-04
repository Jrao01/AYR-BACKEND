-- AlterTable
ALTER TABLE "ContactSubmission" ADD COLUMN     "address" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "wisphubError" TEXT,
ADD COLUMN     "wisphubSentAt" TIMESTAMP(3);
