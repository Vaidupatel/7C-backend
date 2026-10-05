import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
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

    // 1. Calculate patient age
    const ageResult = calculateAge(visit.patient.dob, visit.visitDate);
    const ageMonths = ageResult.totalMonths;

    // 2. Persist VitalSet
    const vitalSet = await this.prisma.vitalSet.create({
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

    // 3. Link Complaint if provided
    if (dto.complaintId) {
      await this.prisma.visitComplaint.upsert({
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

    // 4. Link Signs if provided and fetch their details
    const selectedSigns: Array<{
      name: string;
      redFlagLevel: 'NONE' | 'PRIORITY' | 'EMERGENCY';
    }> = [];

    if (dto.signIds && dto.signIds.length > 0) {
      const signs = await this.prisma.sign.findMany({
        where: { id: { in: dto.signIds } },
      });

      for (const sign of signs) {
        selectedSigns.push({
          name: sign.name,
          redFlagLevel: sign.redFlagLevel,
        });

        await this.prisma.visitSign.upsert({
          where: {
            visitId_signId: {
              visitId: visit.id,
              signId: sign.id,
            },
          },
          update: {},
          create: {
            visitId: visit.id,
            signId: sign.id,
          },
        });
      }
    }

    // 5. Evaluate Vitals
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

    // 6. Growth flags if anthropometry is present
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

    // 7. Calculate Triage
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

    // 8. Upsert TriageResult
    const triageResult = await this.prisma.triageResult.upsert({
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

    // 9. Update Visit status
    await this.prisma.visit.update({
      where: { id: visit.id },
      data: {
        status: VisitStatus.WAITING_DOCTOR,
        notes: dto.notes ? dto.notes : visit.notes,
      },
    });

    return {
      vitalSet,
      triageResult,
      vitalsEvaluation: vitalsEval,
    };
  }
}
