import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OverridePriorityDto } from './dto/override-priority.dto.js';
import { TriageLevel, VisitStatus } from '../generated/prisma/enums.js';

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
            VisitStatus.REGISTERED,
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
        hasGrowthFlag: (v.anthropometry?.weightKg || 0) < 4.0,
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

    // 2. Update TriageResult score and level
    let newScore = 1000;
    if (dto.overrideLevel === TriageLevel.EMERGENCY) newScore = 3500;
    else if (dto.overrideLevel === TriageLevel.PRIORITY) newScore = 2500;

    await this.prisma.triageResult.upsert({
      where: { visitId: visit.id },
      update: {
        level: dto.overrideLevel,
        score: newScore,
      },
      create: {
        visitId: visit.id,
        level: dto.overrideLevel,
        score: newScore,
        reasons: [`Doctor override: ${dto.reason}`],
        configVersion: 'override',
      },
    });

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

    return patient;
  }
}
