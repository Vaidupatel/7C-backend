-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Sign" ADD COLUMN     "proposedByUserId" TEXT,
ADD COLUMN     "status" "ApprovalStatus" NOT NULL DEFAULT 'APPROVED';

-- AlterTable
ALTER TABLE "Visit" ALTER COLUMN "visitDay" SET DEFAULT CURRENT_TIMESTAMP;
