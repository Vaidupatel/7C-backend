import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import {
  safeCalculateAge,
  AgeResult,
  getHospitalDayBoundaries,
} from '../common/utils/age.util.js';
import { VisitType, VisitStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';

export interface PatientSummary {
  id: string;
  uhid: string;
  name: string;
  dob: Date;
  sex: string;
  gestationalAgeWeeks: number | null;
  age: AgeResult;
  primaryGuardian?: {
    name: string;
    relationship: string;
    phone: string;
    motherStatureCm?: number | null;
    fatherStatureCm?: number | null;
  };
  allergiesCount: number;
  totalVisits: number;
}

@Injectable()
export class ReceptionService {
  private readonly logger = new Logger(ReceptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async searchPatients(
    hospitalId: string,
    query: string,
  ): Promise<PatientSummary[]> {
    const q = query.trim();
    if (!q) {
      return [];
    }

    const patients = await this.prisma.patient.findMany({
      where: {
        hospitalId,
        OR: [
          { uhid: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          {
            guardians: {
              some: {
                guardian: {
                  phone: { contains: q },
                },
              },
            },
          },
        ],
      },
      include: {
        guardians: {
          include: { guardian: true },
          where: { isPrimary: true },
        },
        allergies: true,
        visits: { select: { id: true } },
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });

    return patients.map((p) => {
      const primaryG = p.guardians[0]?.guardian;
      const age = safeCalculateAge(
        p.dob,
        new Date(),
        p.gestationalAgeWeeks ?? undefined,
      );

      return {
        id: p.id,
        uhid: p.uhid,
        name: p.name,
        dob: p.dob,
        sex: p.sex,
        gestationalAgeWeeks: p.gestationalAgeWeeks,
        age,
        primaryGuardian: primaryG
          ? {
              name: primaryG.name,
              relationship: primaryG.relationship,
              phone: primaryG.phone,
              motherStatureCm: primaryG.motherStatureCm,
              fatherStatureCm: primaryG.fatherStatureCm,
            }
          : undefined,
        allergiesCount: p.allergies.length,
        totalVisits: p.visits.length,
      };
    });
  }

  async checkDuplicate(
    hospitalId: string,
    name: string,
    dobString: string,
    phone: string,
  ) {
    const dob = new Date(dobString);
    const existing = await this.prisma.patient.findFirst({
      where: {
        hospitalId,
        name: { equals: name.trim(), mode: 'insensitive' },
        dob,
        guardians: {
          some: {
            guardian: { phone: phone.trim() },
          },
        },
      },
      include: {
        guardians: { include: { guardian: true } },
      },
    });

    return existing;
  }

  async registerPatient(
    hospitalId: string,
    dto: CreatePatientDto,
    recordedByUserId?: string,
  ) {
    const dob = new Date(dto.dob);

    // Duplicate detection (Security Check 34 & Acceptance Criteria)
    const duplicate = await this.checkDuplicate(
      hospitalId,
      dto.name,
      dto.dob,
      dto.guardian.phone,
    );

    if (duplicate) {
      throw new ConflictException({
        message:
          'A patient with this name, DOB, and guardian phone already exists',
        existingPatient: {
          id: duplicate.id,
          uhid: duplicate.uhid,
          name: duplicate.name,
        },
      });
    }

    const { year, visitDay } = getHospitalDayBoundaries();

    const result = await this.prisma.$transaction(async (tx) => {
      // D1 fix: Concurrency-safe UHID generation using transaction-level advisory lock
      const uhidLockKey = `uhid_${hospitalId}_${year}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${uhidLockKey})::bigint)`;

      const count = await tx.patient.count({ where: { hospitalId } });
      const uhid = `7C-${year}-${String(count + 1).padStart(5, '0')}`;

      // 1. Create Guardian
      const guardian = await tx.guardian.create({
        data: {
          name: dto.guardian.name.trim(),
          relationship: dto.guardian.relationship.trim(),
          phone: dto.guardian.phone.trim(),
          address: dto.guardian.address,
          motherStatureCm: dto.guardian.motherStatureCm,
          fatherStatureCm: dto.guardian.fatherStatureCm,
          consentGiven: dto.guardian.consentGiven,
          consentPurpose: dto.guardian.consentPurpose,
          consentDate: new Date(),
        },
      });

      // 2. Create Patient (D3: No hazardous default 40 for gestationalAgeWeeks)
      const patient = await tx.patient.create({
        data: {
          uhid,
          name: dto.name.trim(),
          dob,
          sex: dto.sex,
          gestationalAgeWeeks: dto.gestationalAgeWeeks ?? null,
          birthWeightKg: dto.birthWeightKg,
          bloodGroup: dto.bloodGroup,
          hospitalId,
        },
      });

      // 3. Link PatientGuardian
      await tx.patientGuardian.create({
        data: {
          patientId: patient.id,
          guardianId: guardian.id,
          isPrimary: true,
        },
      });

      // 4. Create Allergies
      if (dto.allergies && dto.allergies.length > 0) {
        for (const allergy of dto.allergies) {
          await tx.allergy.create({
            data: {
              patientId: patient.id,
              allergen: allergy.allergen.trim(),
              reaction: allergy.reaction.trim(),
              severity: allergy.severity,
              notes: allergy.notes,
            },
          });
        }
      }

      // 5. Initial Visit if requested
      let visitRecord = null;
      if (dto.visit) {
        const tokenNumber = await this.getNextTokenNumber(hospitalId, tx);

        visitRecord = await tx.visit.create({
          data: {
            patientId: patient.id,
            hospitalId,
            visitDay,
            tokenNumber,
            visitType: VisitType.NEW,
            status: VisitStatus.REGISTERED,
            complaintText: dto.visit.complaintText,
          },
        });

        if (dto.visit.anthropometry) {
          const anthro = dto.visit.anthropometry;
          const heightM = anthro.lengthOrStatureCm / 100;
          const bmi =
            heightM > 0
              ? Math.round((anthro.weightKg / (heightM * heightM)) * 100) / 100
              : null;

          await tx.anthropometry.create({
            data: {
              visitId: visitRecord.id,
              weightKg: anthro.weightKg,
              lengthOrStatureCm: anthro.lengthOrStatureCm,
              measurementMethod: anthro.measurementMethod,
              headCircumferenceCm: anthro.headCircumferenceCm,
              bmi,
              recordedBy: recordedByUserId,
            },
          });
        }
      }

      return { patient, guardian, visit: visitRecord };
    });

    await this.auditService.log({
      userId: recordedByUserId,
      action: 'PATIENT_REGISTERED',
      entityName: 'Patient',
      entityId: result.patient.id,
      details: { uhid: result.patient.uhid },
    });

    return result;
  }

  async createVisit(
    hospitalId: string,
    dto: CreateVisitDto,
    recordedByUserId?: string,
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: dto.patientId },
      include: { visits: true },
    });

    if (!patient || patient.hospitalId !== hospitalId) {
      throw new NotFoundException('Patient not found');
    }

    // Determine New vs Follow-up (Plan Section 8 & Acceptance Criteria)
    const visitType =
      patient.visits.length > 0 ? VisitType.FOLLOW_UP : VisitType.NEW;

    const { visitDay } = getHospitalDayBoundaries();

    const result = await this.prisma.$transaction(async (tx) => {
      const tokenNumber = await this.getNextTokenNumber(hospitalId, tx);

      const visit = await tx.visit.create({
        data: {
          patientId: patient.id,
          hospitalId,
          visitDay,
          tokenNumber,
          visitType,
          status: VisitStatus.REGISTERED,
          complaintText: dto.complaintText,
        },
      });

      if (dto.anthropometry) {
        const anthro = dto.anthropometry;
        const heightM = anthro.lengthOrStatureCm / 100;
        const bmi =
          heightM > 0
            ? Math.round((anthro.weightKg / (heightM * heightM)) * 100) / 100
            : null;

        await tx.anthropometry.create({
          data: {
            visitId: visit.id,
            weightKg: anthro.weightKg,
            lengthOrStatureCm: anthro.lengthOrStatureCm,
            measurementMethod: anthro.measurementMethod,
            headCircumferenceCm: anthro.headCircumferenceCm,
            bmi,
            recordedBy: recordedByUserId,
          },
        });
      }

      return visit;
    });

    await this.auditService.log({
      userId: recordedByUserId,
      action: 'VISIT_CREATED',
      entityName: 'Visit',
      entityId: result.id,
      details: {
        tokenNumber: result.tokenNumber,
        visitType: result.visitType,
      },
    });

    return result;
  }

  async getPatientDetails(hospitalId: string, patientId: string) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
      include: {
        guardians: {
          include: { guardian: true },
        },
        allergies: true,
        visits: {
          select: {
            id: true,
            visitDate: true,
            tokenNumber: true,
            visitType: true,
            status: true,
            complaintText: true,
            createdAt: true,
          },
          orderBy: { visitDate: 'desc' },
        },
      },
    });

    if (!patient || patient.hospitalId !== hospitalId) {
      throw new NotFoundException('Patient record not found');
    }

    const age = safeCalculateAge(
      patient.dob,
      new Date(),
      patient.gestationalAgeWeeks ?? undefined,
    );

    return {
      ...patient,
      age,
    };
  }

  async getTodayVisits(hospitalId: string) {
    const { visitDay } = getHospitalDayBoundaries();

    const visits = await this.prisma.visit.findMany({
      where: {
        hospitalId,
        visitDay,
      },
      include: {
        patient: {
          include: {
            guardians: {
              where: { isPrimary: true },
              include: { guardian: true },
            },
            allergies: true,
          },
        },
      },
      orderBy: { tokenNumber: 'asc' },
    });

    return visits.map((v) => ({
      id: v.id,
      tokenNumber: v.tokenNumber,
      visitType: v.visitType,
      status: v.status,
      visitDate: v.visitDate,
      complaintText: v.complaintText,
      patient: {
        id: v.patient.id,
        uhid: v.patient.uhid,
        name: v.patient.name,
        dob: v.patient.dob,
        sex: v.patient.sex,
        age: safeCalculateAge(
          v.patient.dob,
          v.visitDate,
          v.patient.gestationalAgeWeeks ?? undefined,
        ),
        primaryGuardianPhone: v.patient.guardians[0]?.guardian.phone,
        allergies: v.patient.allergies,
      },
    }));
  }

  /**
   * Concurrency-safe daily token generator inside transaction
   * Uses Asia/Kolkata hospital day boundaries and transaction-level advisory locking
   */
  private async getNextTokenNumber(
    hospitalId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const { visitDay, dateStr } = getHospitalDayBoundaries();

    const lockKey = `token_${hospitalId}_${dateStr}`;
    // Acquire PostgreSQL transaction-level advisory lock hashed on hospital and date
    // to strictly serialize concurrent token allocations without table deadlocks
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

    const lastVisit = await tx.visit.findFirst({
      where: {
        hospitalId,
        visitDay,
      },
      orderBy: { tokenNumber: 'desc' },
      select: { tokenNumber: true },
    });

    return (lastVisit?.tokenNumber ?? 0) + 1;
  }
}
