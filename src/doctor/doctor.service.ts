import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OverridePriorityDto } from './dto/override-priority.dto.js';
import { TriageLevel, VisitStatus } from '../generated/prisma/enums.js';
import { calculateAge } from '../common/utils/age.util.js';

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  async getDoctorQueue(hospitalId: string) {
    const visits = await this.prisma.visit.findMany({
      where: {
        hospitalId,
        status: {
          in: [
            VisitStatus.WAITING_DOCTOR,
            VisitStatus.VITALS_DONE,
            VisitStatus.IN_CONSULTATION,
          ],
        },
      },
      include: {
        patient: {
          select: {
            id: true,
            uhid: true,
            name: true,
            dob: true,
            sex: true,
            allergies: true,
          },
        },
        anthropometry: true,
        vitals: {
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
        signs: {
          include: {
            sign: true,
          },
        },
        complaints: {
          include: {
            complaint: true,
          },
        },
        triageResult: true,
        priorityOverrides: {
          orderBy: { overriddenAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ tokenNumber: 'asc' }],
    });

    const now = Date.now();

    // Map each visit to an urgency item
    const queue = visits.map((v) => {
      const waitMinutes = Math.floor(
        (now - new Date(v.createdAt).getTime()) / 60000,
      );

      // Latest override if present
      const latestOverride = v.priorityOverrides[0];
      const effectiveLevel: TriageLevel = latestOverride
        ? latestOverride.overrideLevel
        : v.triageResult?.level || TriageLevel.ROUTINE;

      // Extract reasons safely from json
      const rawReasons = v.triageResult?.reasons;
      const reasons: string[] = Array.isArray(rawReasons)
        ? (rawReasons as string[])
        : [];

      if (latestOverride) {
        reasons.unshift(
          `Clinician override: ${latestOverride.overrideLevel} (${latestOverride.reason})`,
        );
      }

      // Numerical score for sorting
      let sortScore = v.triageResult?.score || 1000;
      if (effectiveLevel === TriageLevel.EMERGENCY) {
        sortScore = Math.max(sortScore, 3000);
      } else if (effectiveLevel === TriageLevel.PRIORITY) {
        sortScore = Math.max(sortScore, 2000);
      }

      return {
        visitId: v.id,
        patientId: v.patient.id,
        uhid: v.patient.uhid,
        name: v.patient.name,
        dob: v.patient.dob,
        sex: v.patient.sex,
        visitType: v.visitType,
        tokenNumber: v.tokenNumber,
        status: v.status,
        createdAt: v.createdAt,
        waitingMinutes: waitMinutes,
        effectiveLevel,
        originalLevel: v.triageResult?.level || TriageLevel.ROUTINE,
        isOverridden: !!latestOverride,
        score: sortScore,
        reasons,
        complaints: v.complaints.map((c) => c.complaint.name),
        signs: v.signs.map((s) => ({
          name: s.sign.name,
          redFlagLevel: s.sign.redFlagLevel,
        })),
        allergies: v.patient.allergies.map((a) => ({
          allergen: a.allergen,
          reaction: a.reaction,
          severity: a.severity,
        })),
        hasGrowthFlag: reasons.some(
          (r) =>
            r.toLowerCase().includes('growth') ||
            r.toLowerCase().includes('underweight') ||
            r.toLowerCase().includes('microcephaly') ||
            r.toLowerCase().includes('stature') ||
            r.toLowerCase().includes('stunting') ||
            r.toLowerCase().includes('wasting'),
        ),
        latestVitals: v.vitals[0] || null,
        anthropometry: v.anthropometry,
      };
    });

    // Urgency sorting: highest score first, then earliest token number
    queue.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.tokenNumber - b.tokenNumber;
    });

    return queue;
  }

  async overridePriority(
    hospitalId: string,
    clinicianId: string,
    clinicianName: string,
    dto: OverridePriorityDto,
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: dto.visitId },
      include: { triageResult: true },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.hospitalId !== hospitalId) {
      throw new ForbiddenException('Access denied to other hospital data');
    }

    const originalLevel = visit.triageResult?.level || TriageLevel.ROUTINE;

    // 1. Create PriorityOverride record
    const override = await this.prisma.priorityOverride.create({
      data: {
        visitId: visit.id,
        originalLevel,
        overrideLevel: dto.overrideLevel,
        reason: dto.reason,
        clinicianId,
        clinicianName,
      },
    });

    // 2. System TriageResult remains immutable (Finding C6 & Clinical Rule 5).
    // The override is recorded in PriorityOverride table and reflected in effectiveLevel.

    // 3. Audit log (without sensitive patient data)
    await this.prisma.auditLog.create({
      data: {
        userId: clinicianId,
        userRole: 'DOCTOR',
        action: 'PRIORITY_OVERRIDE',
        entityName: 'Visit',
        entityId: visit.id,
        details: {
          originalLevel,
          overrideLevel: dto.overrideLevel,
          reason: dto.reason,
        },
      },
    });

    return override;
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
          orderBy: { visitDate: 'desc' },
          include: {
            anthropometry: true,
            vitals: {
              orderBy: { recordedAt: 'desc' },
            },
            complaints: {
              include: { complaint: true },
            },
            signs: {
              include: { sign: true },
            },
            triageResult: true,
            priorityOverrides: true,
          },
        },
      },
    });

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (patient.hospitalId !== hospitalId) {
      throw new ForbiddenException('Access denied to other hospital data');
    }

    const visitsWithAge = patient.visits.map((v) => {
      const ageResult = calculateAge(
        patient.dob,
        v.visitDate,
        patient.gestationalAgeWeeks ?? undefined,
      );
      return {
        ...v,
        ageMonths: Math.round(ageResult.totalMonths * 10) / 10,
        formattedAge: ageResult.formattedAge,
      };
    });

    return {
      ...patient,
      visits: visitsWithAge,
    };
  }

  /**
   * C7 fix: Visit lifecycle state transitions (IN_CONSULTATION, COMPLETED, LEFT_WITHOUT_BEING_SEEN)
   */
  async updateVisitStatus(
    hospitalId: string,
    visitId: string,
    clinicianId: string,
    dto: { status: VisitStatus; notes?: string },
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit || visit.hospitalId !== hospitalId) {
      throw new NotFoundException('Visit not found');
    }

    const previousStatus = visit.status;

    const updated = await this.prisma.visit.update({
      where: { id: visitId },
      data: { status: dto.status },
    });

    await this.prisma.auditLog.create({
      data: {
        userId: clinicianId,
        userRole: 'DOCTOR',
        action: 'VISIT_STATUS_TRANSITION',
        entityName: 'Visit',
        entityId: visit.id,
        details: {
          previousStatus,
          newStatus: dto.status,
          notes: dto.notes,
        },
      },
    });

    return updated;
  }
}
