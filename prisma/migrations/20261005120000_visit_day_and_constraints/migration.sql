-- AlterTable Guardian: remove hazardous consent default
ALTER TABLE "Guardian" ALTER COLUMN "consentGiven" DROP DEFAULT;

-- AlterTable Patient: remove hazardous gestational age default
ALTER TABLE "Patient" ALTER COLUMN "gestationalAgeWeeks" DROP DEFAULT;

-- AlterTable Visit: add visitDay column and backfill from visitDate
ALTER TABLE "Visit" ADD COLUMN "visitDay" DATE NOT NULL DEFAULT CURRENT_DATE;
UPDATE "Visit" SET "visitDay" = "visitDate"::DATE;

-- Drop old unique index on hospitalId, visitDate, tokenNumber
DROP INDEX IF EXISTS "Visit_hospitalId_visitDate_tokenNumber_key";

-- Create new unique index on hospitalId, visitDay, tokenNumber
CREATE UNIQUE INDEX "Visit_hospitalId_visitDay_tokenNumber_key" ON "Visit"("hospitalId", "visitDay", "tokenNumber");

-- Create index on visitDay
CREATE INDEX "Visit_visitDay_idx" ON "Visit"("visitDay");

-- Alter foreign key constraints to Restrict (D4: Clinical records must not be cascade-wiped)
ALTER TABLE "PatientGuardian" DROP CONSTRAINT "PatientGuardian_patientId_fkey";
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PatientGuardian" DROP CONSTRAINT "PatientGuardian_guardianId_fkey";
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Allergy" DROP CONSTRAINT "Allergy_patientId_fkey";
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Visit" DROP CONSTRAINT "Visit_patientId_fkey";
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Anthropometry" DROP CONSTRAINT "Anthropometry_visitId_fkey";
ALTER TABLE "Anthropometry" ADD CONSTRAINT "Anthropometry_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VitalSet" DROP CONSTRAINT "VitalSet_visitId_fkey";
ALTER TABLE "VitalSet" ADD CONSTRAINT "VitalSet_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitComplaint" DROP CONSTRAINT "VisitComplaint_visitId_fkey";
ALTER TABLE "VisitComplaint" ADD CONSTRAINT "VisitComplaint_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitSign" DROP CONSTRAINT "VisitSign_visitId_fkey";
ALTER TABLE "VisitSign" ADD CONSTRAINT "VisitSign_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TriageResult" DROP CONSTRAINT "TriageResult_visitId_fkey";
ALTER TABLE "TriageResult" ADD CONSTRAINT "TriageResult_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PriorityOverride" DROP CONSTRAINT "PriorityOverride_visitId_fkey";
ALTER TABLE "PriorityOverride" ADD CONSTRAINT "PriorityOverride_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
