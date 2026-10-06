import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RecordVitalsDto } from './dto/record-vitals.dto.js';
import { calculateAge } from '../common/utils/age.util.js';
import { evaluateVitals } from '../common/utils/vitals.util.js';
import { calculateTriage } from '../common/utils/triage.util.js';
import { VisitStatus } from '../generated/prisma/enums.js';
import { GrowthService } from '../growth/growth.service.js';

@Injectable()
export class VitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly growthService: GrowthService,
    private readonly auditService: AuditService,
  ) {}

  async getNeedsVitalsQueue(hospitalId: string) {
    return this.prisma.visit.findMany({
      where: {
        hospitalId,
        status: VisitStatus.REGISTERED,
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
      },
      orderBy: [{ tokenNumber: 'asc' }],
    });
  }

  async recordVitals(
    hospitalId: string,
    dto: RecordVitalsDto,
    clinicianId: string,
    clinicianRole?: string,
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: dto.visitId },
      include: {
        patient: true,
        anthropometry: true,
      },
    });

    if (!visit) {
      throw new NotFoundException('Visit not found');
    }

    if (visit.hospitalId !== hospitalId) {
      throw new ForbiddenException('Access denied to other hospital data');
    }

    // F5: Only REGISTERED or WAITING_DOCTOR visits can accept vitals
    if (
      visit.status !== VisitStatus.REGISTERED &&
      visit.status !== VisitStatus.WAITING_DOCTOR
    ) {
      throw new ConflictException(
        `Cannot record vitals for visit with status '${visit.status}'. Vitals can only be recorded for visits in REGISTERED or WAITING_DOCTOR status.`,
      );
    }

    // F5: Validate sign IDs are active and existent (reject 400 on unknown/inactive)
    const selectedSigns: Array<{
      name: string;
      redFlagLevel: 'NONE' | 'PRIORITY' | 'EMERGENCY';
    }> = [];

    if (dto.signIds && dto.signIds.length > 0) {
      const activeSigns = await this.prisma.sign.findMany({
        where: {
          id: { in: dto.signIds },
          active: true,
        },
      });

      if (activeSigns.length !== dto.signIds.length) {
        const foundIds = new Set(activeSigns.map((s) => s.id));
        const invalidIds = dto.signIds.filter((id) => !foundIds.has(id));
        throw new BadRequestException(
          `One or more sign IDs are invalid or inactive: ${invalidIds.join(', ')}`,
        );
      }

      for (const sign of activeSigns) {
        selectedSigns.push({
          name: sign.name,
          redFlagLevel: sign.redFlagLevel,
        });
      }
    }

    // F5: Validate complaint ID if provided
    if (dto.complaintId) {
      const activeComplaint = await this.prisma.complaint.findUnique({
        where: { id: dto.complaintId },
      });
      if (!activeComplaint || !activeComplaint.active) {
        throw new BadRequestException(
          `Complaint '${dto.complaintId}' is invalid or inactive`,
        );
      }
    }

    // 1. Calculate patient age
    const ageResult = calculateAge(visit.patient.dob, visit.visitDate);
    const ageMonths = ageResult.totalMonths;

    // 2. Evaluate Vitals
    const vitalsEval = evaluateVitals({
      ageMonths,
      heartRateBpm: dto.heartRateBpm,
      respiratoryRateBpm: dto.respiratoryRateBpm,
      bpSystolic: dto.bpSystolic,
      bpDiastolic: dto.bpDiastolic,
      spo2Percent: dto.spo2Percent,
      temperatureC: dto.temperatureC,
      capillaryRefillSec: dto.capillaryRefillSec,
      painScore: dto.painScore,
      avpu: dto.avpu,
    });

    // 3. Growth flags if anthropometry is present
    const growthFlags: Array<{
      severity: 'NORMAL' | 'PRIORITY' | 'EMERGENCY';
      label: string;
    }> = [];

    if (visit.anthropometry) {
      try {
        const growthEval = await this.growthService.evaluateGrowth({
          sex: visit.patient.sex,
          ageMonths,
          weightKg: visit.anthropometry.weightKg,
          lengthOrStatureCm: visit.anthropometry.lengthOrStatureCm,
          headCircumferenceCm:
            visit.anthropometry.headCircumferenceCm ?? undefined,
        });

        for (const ev of growthEval.evaluations) {
          if (ev.severity !== 'NORMAL') {
            growthFlags.push({
              severity: ev.severity,
              label:
                ev.clinicalFlag ||
                `${ev.measure} Z=${ev.zScore} (${ev.percentile}th %ile)`,
            });
          }
        }
      } catch {
        // Clinical Rule 5: Mark NOT_EVALUATED / safety bias if growth data missing
        growthFlags.push({
          severity: 'PRIORITY',
          label: 'Growth: Reference data pending approval / not evaluated',
        });
      }
    }

    // 4. Calculate Triage
    const waitMinutes = Math.floor(
      (Date.now() - new Date(visit.createdAt).getTime()) / 60000,
    );

    const triage = calculateTriage({
      vitalsSeverity: vitalsEval.overallSeverity,
      vitalsReasons: vitalsEval.findings.map((f) => f.reason),
      signs: selectedSigns,
      growthFlags,
      waitingMinutes: waitMinutes,
      missingDataWarnings: vitalsEval.warnings,
    });

    const isReRecord = visit.status === VisitStatus.WAITING_DOCTOR;

    // 5. Transactional execution of all writes (F5)
    const result = await this.prisma.$transaction(async (tx) => {
      // If re-recording on a visit that already had vitals, supersede previous records
      if (isReRecord) {
        await tx.vitalSet.deleteMany({
          where: { visitId: visit.id },
        });
        await tx.visitSign.deleteMany({
          where: { visitId: visit.id },
        });
        if (dto.complaintId) {
          await tx.visitComplaint.deleteMany({
            where: { visitId: visit.id },
          });
        }
      }

      // Persist new VitalSet
      const vitalSet = await tx.vitalSet.create({
        data: {
          visitId: visit.id,
          heartRateBpm: dto.heartRateBpm,
          respiratoryRateBpm: dto.respiratoryRateBpm,
          bpSystolic: dto.bpSystolic,
          bpDiastolic: dto.bpDiastolic,
          spo2Percent: dto.spo2Percent,
          temperatureC: dto.temperatureC,
          temperatureSite: dto.temperatureSite,
          painScore: dto.painScore,
          capillaryRefillSec: dto.capillaryRefillSec,
          avpu: dto.avpu,
          recordedBy: clinicianId,
        },
      });

      // Link Complaint if provided
      if (dto.complaintId) {
        await tx.visitComplaint.upsert({
          where: {
            visitId_complaintId: {
              visitId: visit.id,
              complaintId: dto.complaintId,
            },
          },
          update: {},
          create: {
            visitId: visit.id,
            complaintId: dto.complaintId,
          },
        });
      }

      // Link Signs if provided
      if (dto.signIds && dto.signIds.length > 0) {
        for (const signId of dto.signIds) {
          await tx.visitSign.upsert({
            where: {
              visitId_signId: {
                visitId: visit.id,
                signId,
              },
            },
            update: {},
            create: {
              visitId: visit.id,
              signId,
            },
          });
        }
      }

      // Upsert TriageResult
      const triageResult = await tx.triageResult.upsert({
        where: { visitId: visit.id },
        update: {
          level: triage.level,
          score: triage.score,
          reasons: triage.reasons,
          configVersion: triage.configVersion,
        },
        create: {
          visitId: visit.id,
          level: triage.level,
          score: triage.score,
          reasons: triage.reasons,
          configVersion: triage.configVersion,
        },
      });

      // Update Visit status to WAITING_DOCTOR
      await tx.visit.update({
        where: { id: visit.id },
        data: {
          status: VisitStatus.WAITING_DOCTOR,
          notes: dto.notes ? dto.notes : visit.notes,
        },
      });

      return { vitalSet, triageResult };
    });

    await this.auditService.log({
      userId: clinicianId,
      userRole: clinicianRole,
      action: isReRecord ? 'VITALS_RE_RECORDED' : 'VITALS_RECORDED',
      entityName: 'Visit',
      entityId: visit.id,
      details: {
        visitId: visit.id,
        isReRecord,
        triageLevel: triage.level,
        triageScore: triage.score,
      },
    });

    return {
      vitalSet: result.vitalSet,
      triageResult: result.triageResult,
      vitalsEvaluation: vitalsEval,
    };
  }
}
