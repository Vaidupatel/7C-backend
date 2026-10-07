import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { OverridePriorityDto } from './dto/override-priority.dto.js';
import { TriageLevel, VisitStatus } from '../generated/prisma/enums.js';
import { safeCalculateAge } from '../common/utils/age.util.js';
import type { StructuredReason } from '../common/utils/triage.util.js';

export const ALLOWED_VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  [VisitStatus.REGISTERED]: [VisitStatus.WAITING_DOCTOR],
  [VisitStatus.VITALS_DONE]: [
    VisitStatus.WAITING_DOCTOR,
    VisitStatus.IN_CONSULTATION,
    VisitStatus.LEFT_WITHOUT_BEING_SEEN,
  ],
  [VisitStatus.WAITING_DOCTOR]: [
    VisitStatus.IN_CONSULTATION,
    VisitStatus.LEFT_WITHOUT_BEING_SEEN,
  ],
  [VisitStatus.IN_CONSULTATION]: [
    VisitStatus.COMPLETED,
    VisitStatus.LEFT_WITHOUT_BEING_SEEN,
  ],
  [VisitStatus.COMPLETED]: [],
  [VisitStatus.LEFT_WITHOUT_BEING_SEEN]: [],
};

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

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
      const hasTriage = !!v.triageResult;
      const originalLevel: TriageLevel | 'NOT_TRIAGED' = hasTriage
        ? v.triageResult!.level
        : 'NOT_TRIAGED';

      const effectiveLevel: TriageLevel | 'NOT_TRIAGED' = latestOverride
        ? latestOverride.overrideLevel
        : originalLevel;

      // Extract structured reasons safely from json (F7)
      const rawReasons = v.triageResult?.reasons;
      const structuredReasons: StructuredReason[] = Array.isArray(rawReasons)
        ? rawReasons.map((r: unknown) => {
            if (
              typeof r === 'object' &&
              r !== null &&
              'label' in r &&
              'source' in r
            ) {
              return r as StructuredReason;
            }
            // Fallback for legacy string reasons
            const text = String(r);
            const isGrowth =
              text.toLowerCase().includes('growth') ||
              text.toLowerCase().includes('underweight') ||
              text.toLowerCase().includes('wasting') ||
              text.toLowerCase().includes('stature') ||
              text.toLowerCase().includes('stunting');
            return {
              code: isGrowth ? 'GROWTH_FLAG' : 'LEGACY_REASON',
              severity: 'INFO',
              label: text,
              source: isGrowth ? 'GROWTH' : 'SYSTEM',
            };
          })
        : [];

      if (!hasTriage && !latestOverride) {
        structuredReasons.push({
          code: 'PENDING_TRIAGE',
          severity: 'INFO',
          label: 'Pending clinical vitals & triage evaluation',
          source: 'SYSTEM',
        });
      }

      if (latestOverride) {
        structuredReasons.unshift({
          code: 'CLINICIAN_OVERRIDE',
          severity: latestOverride.overrideLevel,
          label: `Clinician override: ${latestOverride.overrideLevel} (${latestOverride.reason})`,
          source: 'OVERRIDE',
        });
      }

      // F7: Reliable growth flag detection: source === 'GROWTH'
      const hasGrowthFlag = structuredReasons.some(
        (r) => r.source === 'GROWTH',
      );
      const reasonLabels = structuredReasons.map((r) => r.label);

      // Numerical score for sorting:
      // EMERGENCY: >= 3000
      // NOT_TRIAGED: 2500 (Safety bias: sorted above ROUTINE so clinician is alerted)
      // PRIORITY: >= 2000
      // ROUTINE: >= 1000
      let sortScore =
        v.triageResult?.score ||
        (effectiveLevel === 'NOT_TRIAGED' ? 2500 : 1000);
      if (effectiveLevel === TriageLevel.EMERGENCY) {
        sortScore = Math.max(sortScore, 3000);
      } else if (effectiveLevel === 'NOT_TRIAGED') {
        sortScore = 2500;
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
        originalLevel,
        isOverridden: !!latestOverride,
        overrideReason: latestOverride?.reason ?? null,
        score: sortScore,
        reasons: reasonLabels,
        structuredReasons,
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
        hasGrowthFlag,
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
    await this.auditService.log({
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
      const ageResult = safeCalculateAge(
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
   * C7 & F1 fix: Visit lifecycle state transitions (IN_CONSULTATION, COMPLETED, LEFT_WITHOUT_BEING_SEEN)
   * Enforces legal transitions and rejects invalid progression with 409 Conflict.
   */
  async updateVisitStatus(
    hospitalId: string,
    visitId: string,
    clinicianId: string,
    clinicianRole: string,
    dto: { status: VisitStatus; notes?: string },
  ) {
    const visit = await this.prisma.visit.findUnique({
      where: { id: visitId },
    });

    if (!visit || visit.hospitalId !== hospitalId) {
      throw new NotFoundException('Visit not found');
    }

    const previousStatus = visit.status;
    const allowed = ALLOWED_VISIT_TRANSITIONS[previousStatus] ?? [];

    if (!allowed.includes(dto.status)) {
      throw new ConflictException(
        `Cannot transition visit status from ${previousStatus} to ${dto.status}. Allowed transitions: ${allowed.join(', ') || 'none (terminal status)'}`,
      );
    }

    const updated = await this.prisma.visit.update({
      where: { id: visitId },
      data: {
        status: dto.status,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    await this.auditService.log({
      userId: clinicianId,
      userRole: clinicianRole,
      action: 'VISIT_STATUS_TRANSITION',
      entityName: 'Visit',
      entityId: visit.id,
      details: {
        previousStatus,
        newStatus: dto.status,
        notes: dto.notes,
      },
    });

    return updated;
  }
}
