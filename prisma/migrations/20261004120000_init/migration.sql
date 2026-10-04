-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'RECEPTIONIST', 'MEDICAL_OFFICER', 'DOCTOR');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "MeasurementMethod" AS ENUM ('RECUMBENT', 'STANDING');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('NEW', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('REGISTERED', 'VITALS_DONE', 'WAITING_DOCTOR', 'IN_CONSULTATION', 'COMPLETED', 'LEFT_WITHOUT_BEING_SEEN');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');

-- CreateEnum
CREATE TYPE "RedFlagLevel" AS ENUM ('NONE', 'PRIORITY', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "TriageLevel" AS ENUM ('EMERGENCY', 'PRIORITY', 'ROUTINE');

-- CreateEnum
CREATE TYPE "Avpu" AS ENUM ('ALERT', 'VERBAL', 'PAIN', 'UNRESPONSIVE');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING_DOCTOR_APPROVAL', 'APPROVED');

-- CreateEnum
CREATE TYPE "GrowthStandard" AS ENUM ('CDC', 'WHO');

-- CreateEnum
CREATE TYPE "GrowthMeasure" AS ENUM ('WEIGHT_FOR_AGE', 'LENGTH_FOR_AGE', 'STATURE_FOR_AGE', 'BMI_FOR_AGE', 'HEAD_CIRCUMFERENCE_FOR_AGE', 'WEIGHT_FOR_LENGTH', 'WEIGHT_FOR_STATURE');

-- CreateTable
CREATE TABLE "Hospital" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "temporaryPassword" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedByTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guardian" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "motherStatureCm" DOUBLE PRECISION,
    "fatherStatureCm" DOUBLE PRECISION,
    "consentGiven" BOOLEAN NOT NULL DEFAULT true,
    "consentDate" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "consentPurpose" TEXT DEFAULT 'Pediatric outpatient care and clinical observation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "uhid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dob" TIMESTAMP(3) NOT NULL,
    "sex" "Sex" NOT NULL,
    "gestationalAgeWeeks" INTEGER DEFAULT 40,
    "birthWeightKg" DOUBLE PRECISION,
    "bloodGroup" TEXT,
    "hospitalId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientGuardian" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientGuardian_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Allergy" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    "reaction" TEXT NOT NULL,
    "severity" "AllergySeverity" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allergy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenNumber" INTEGER NOT NULL,
    "visitType" "VisitType" NOT NULL DEFAULT 'NEW',
    "status" "VisitStatus" NOT NULL DEFAULT 'REGISTERED',
    "complaintText" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anthropometry" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "lengthOrStatureCm" DOUBLE PRECISION NOT NULL,
    "measurementMethod" "MeasurementMethod" NOT NULL,
    "headCircumferenceCm" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,

    CONSTRAINT "Anthropometry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalSet" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "heartRateBpm" INTEGER,
    "respiratoryRateBpm" INTEGER,
    "bpSystolic" INTEGER,
    "bpDiastolic" INTEGER,
    "spo2Percent" DOUBLE PRECISION,
    "temperatureC" DOUBLE PRECISION,
    "temperatureSite" TEXT,
    "painScore" INTEGER,
    "capillaryRefillSec" DOUBLE PRECISION,
    "avpu" "Avpu" DEFAULT 'ALERT',
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedBy" TEXT,

    CONSTRAINT "VitalSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bodySystem" TEXT NOT NULL,
    "redFlagLevel" "RedFlagLevel" NOT NULL DEFAULT 'NONE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintSign" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "signId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintSign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitComplaint" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitSign" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "signId" TEXT NOT NULL,
    "durationDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitSign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrowthReference" (
    "id" TEXT NOT NULL,
    "standard" "GrowthStandard" NOT NULL,
    "measure" "GrowthMeasure" NOT NULL,
    "sex" "Sex" NOT NULL,
    "ageMonths" DOUBLE PRECISION NOT NULL,
    "l" DOUBLE PRECISION NOT NULL,
    "m" DOUBLE PRECISION NOT NULL,
    "s" DOUBLE PRECISION NOT NULL,
    "p3" DOUBLE PRECISION,
    "p5" DOUBLE PRECISION,
    "p10" DOUBLE PRECISION,
    "p25" DOUBLE PRECISION,
    "p50" DOUBLE PRECISION,
    "p75" DOUBLE PRECISION,
    "p90" DOUBLE PRECISION,
    "p95" DOUBLE PRECISION,
    "p97" DOUBLE PRECISION,
    "p85" DOUBLE PRECISION,
    "sourceUrl" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '2000-05-30',

    CONSTRAINT "GrowthReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VitalRange" (
    "id" TEXT NOT NULL,
    "vitalName" TEXT NOT NULL,
    "minAgeMonths" INTEGER NOT NULL,
    "maxAgeMonths" INTEGER NOT NULL,
    "lowCritical" DOUBLE PRECISION,
    "lowNormal" DOUBLE PRECISION NOT NULL,
    "highNormal" DOUBLE PRECISION NOT NULL,
    "highCritical" DOUBLE PRECISION,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "approvedBy" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING_DOCTOR_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VitalRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageResult" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "level" "TriageLevel" NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "configVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriageResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorityOverride" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "originalLevel" "TriageLevel" NOT NULL,
    "overrideLevel" "TriageLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "clinicianId" TEXT NOT NULL,
    "clinicianName" TEXT NOT NULL,
    "overriddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriorityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userRole" TEXT,
    "action" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "entityId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drug" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Drug_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DosingRule" (
    "id" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "minAgeMonths" INTEGER,
    "maxAgeMonths" INTEGER,
    "mgPerKgPerDose" DOUBLE PRECISION,
    "maxDoseMg" DOUBLE PRECISION,
    "frequency" TEXT,
    "indication" TEXT,
    "sourceCitation" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING_DOCTOR_APPROVAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DosingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "drugName" TEXT NOT NULL,
    "doseText" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpPlan" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpResponse" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_slug_key" ON "Hospital"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_hospitalId_idx" ON "User"("hospitalId");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Guardian_phone_idx" ON "Guardian"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Patient_uhid_key" ON "Patient"("uhid");

-- CreateIndex
CREATE INDEX "Patient_hospitalId_idx" ON "Patient"("hospitalId");

-- CreateIndex
CREATE INDEX "Patient_uhid_idx" ON "Patient"("uhid");

-- CreateIndex
CREATE INDEX "Patient_name_idx" ON "Patient"("name");

-- CreateIndex
CREATE INDEX "PatientGuardian_patientId_idx" ON "PatientGuardian"("patientId");

-- CreateIndex
CREATE INDEX "PatientGuardian_guardianId_idx" ON "PatientGuardian"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientGuardian_patientId_guardianId_key" ON "PatientGuardian"("patientId", "guardianId");

-- CreateIndex
CREATE INDEX "Allergy_patientId_idx" ON "Allergy"("patientId");

-- CreateIndex
CREATE INDEX "Visit_hospitalId_status_idx" ON "Visit"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "Visit_patientId_idx" ON "Visit"("patientId");

-- CreateIndex
CREATE INDEX "Visit_visitDate_idx" ON "Visit"("visitDate");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_hospitalId_visitDate_tokenNumber_key" ON "Visit"("hospitalId", "visitDate", "tokenNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Anthropometry_visitId_key" ON "Anthropometry"("visitId");

-- CreateIndex
CREATE INDEX "Anthropometry_visitId_idx" ON "Anthropometry"("visitId");

-- CreateIndex
CREATE INDEX "VitalSet_visitId_idx" ON "VitalSet"("visitId");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_name_key" ON "Complaint"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Sign_name_key" ON "Sign"("name");

-- CreateIndex
CREATE INDEX "ComplaintSign_complaintId_idx" ON "ComplaintSign"("complaintId");

-- CreateIndex
CREATE INDEX "ComplaintSign_signId_idx" ON "ComplaintSign"("signId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintSign_complaintId_signId_key" ON "ComplaintSign"("complaintId", "signId");

-- CreateIndex
CREATE INDEX "VisitComplaint_visitId_idx" ON "VisitComplaint"("visitId");

-- CreateIndex
CREATE INDEX "VisitComplaint_complaintId_idx" ON "VisitComplaint"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitComplaint_visitId_complaintId_key" ON "VisitComplaint"("visitId", "complaintId");

-- CreateIndex
CREATE INDEX "VisitSign_visitId_idx" ON "VisitSign"("visitId");

-- CreateIndex
CREATE INDEX "VisitSign_signId_idx" ON "VisitSign"("signId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitSign_visitId_signId_key" ON "VisitSign"("visitId", "signId");

-- CreateIndex
CREATE INDEX "GrowthReference_standard_measure_sex_idx" ON "GrowthReference"("standard", "measure", "sex");

-- CreateIndex
CREATE UNIQUE INDEX "GrowthReference_standard_measure_sex_ageMonths_key" ON "GrowthReference"("standard", "measure", "sex", "ageMonths");

-- CreateIndex
CREATE INDEX "VitalRange_vitalName_minAgeMonths_maxAgeMonths_idx" ON "VitalRange"("vitalName", "minAgeMonths", "maxAgeMonths");

-- CreateIndex
CREATE UNIQUE INDEX "TriageResult_visitId_key" ON "TriageResult"("visitId");

-- CreateIndex
CREATE INDEX "TriageResult_level_idx" ON "TriageResult"("level");

-- CreateIndex
CREATE INDEX "PriorityOverride_visitId_idx" ON "PriorityOverride"("visitId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityName_entityId_idx" ON "AuditLog"("entityName", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Drug_name_key" ON "Drug"("name");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientGuardian" ADD CONSTRAINT "PatientGuardian_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Allergy" ADD CONSTRAINT "Allergy_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anthropometry" ADD CONSTRAINT "Anthropometry_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalSet" ADD CONSTRAINT "VitalSet_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintSign" ADD CONSTRAINT "ComplaintSign_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintSign" ADD CONSTRAINT "ComplaintSign_signId_fkey" FOREIGN KEY ("signId") REFERENCES "Sign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitComplaint" ADD CONSTRAINT "VisitComplaint_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitComplaint" ADD CONSTRAINT "VisitComplaint_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSign" ADD CONSTRAINT "VisitSign_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitSign" ADD CONSTRAINT "VisitSign_signId_fkey" FOREIGN KEY ("signId") REFERENCES "Sign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageResult" ADD CONSTRAINT "TriageResult_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorityOverride" ADD CONSTRAINT "PriorityOverride_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
