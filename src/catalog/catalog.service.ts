import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CreateSignDto } from './dto/create-sign.dto.js';
import { ProposeSignDto } from './dto/propose-sign.dto.js';
import { UpdateSignDto } from './dto/update-sign.dto.js';
import { ApprovalStatus, RedFlagLevel } from '../generated/prisma/enums.js';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getComplaints() {
    return this.prisma.complaint.findMany({
      where: { active: true },
      include: {
        signs: {
          include: {
            sign: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getSigns() {
    return this.prisma.sign.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async getSignProposals() {
    return this.prisma.sign.findMany({
      where: {
        active: true,
        status: ApprovalStatus.PENDING_DOCTOR_APPROVAL,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createSign(dto: CreateSignDto, adminId?: string) {
    const sign = await this.prisma.sign.upsert({
      where: { name: dto.name },
      update: {
        bodySystem: dto.bodySystem,
        redFlagLevel: dto.redFlagLevel ?? RedFlagLevel.NONE,
        status: ApprovalStatus.APPROVED,
        active: true,
      },
      create: {
        name: dto.name,
        bodySystem: dto.bodySystem,
        redFlagLevel: dto.redFlagLevel ?? RedFlagLevel.NONE,
        status: ApprovalStatus.APPROVED,
      },
    });

    if (dto.complaintId) {
      await this.prisma.complaintSign.upsert({
        where: {
          complaintId_signId: {
            complaintId: dto.complaintId,
            signId: sign.id,
          },
        },
        update: {},
        create: {
          complaintId: dto.complaintId,
          signId: sign.id,
        },
      });
    }

    if (adminId) {
      await this.auditService.log({
        userId: adminId,
        userRole: 'ADMIN',
        action: 'SIGN_CREATED',
        entityName: 'Sign',
        entityId: sign.id,
        details: {
          name: sign.name,
          redFlagLevel: sign.redFlagLevel,
          bodySystem: sign.bodySystem,
        },
      });
    }

    return sign;
  }

  /**
   * F2 requirement: MO or DOCTOR dynamic sign proposal.
   * Forces status PENDING_DOCTOR_APPROVAL and redFlagLevel NONE so it cannot
   * inappropriately escalate triage priority before clinical review.
   */
  async proposeSign(dto: ProposeSignDto, userId: string, userRole: string) {
    const sign = await this.prisma.sign.upsert({
      where: { name: dto.name },
      update: {
        bodySystem: dto.bodySystem,
        active: true,
      },
      create: {
        name: dto.name,
        bodySystem: dto.bodySystem,
        redFlagLevel: RedFlagLevel.NONE,
        status: ApprovalStatus.PENDING_DOCTOR_APPROVAL,
        proposedByUserId: userId,
      },
    });

    if (dto.complaintId) {
      await this.prisma.complaintSign.upsert({
        where: {
          complaintId_signId: {
            complaintId: dto.complaintId,
            signId: sign.id,
          },
        },
        update: {},
        create: {
          complaintId: dto.complaintId,
          signId: sign.id,
        },
      });
    }

    await this.auditService.log({
      userId,
      userRole,
      action: 'SIGN_PROPOSED',
      entityName: 'Sign',
      entityId: sign.id,
      details: {
        name: dto.name,
        bodySystem: dto.bodySystem,
        complaintId: dto.complaintId,
      },
    });

    return sign;
  }

  /**
   * Governance: Admin or Doctor updates sign redFlagLevel, approval status, bodySystem, or active state.
   * Fully audited with before-and-after values.
   */
  async updateSign(
    id: string,
    dto: UpdateSignDto,
    userId: string,
    userRole: string,
  ) {
    const existing = await this.prisma.sign.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Sign with id ${id} not found`);
    }

    const updated = await this.prisma.sign.update({
      where: { id },
      data: {
        ...(dto.bodySystem !== undefined ? { bodySystem: dto.bodySystem } : {}),
        ...(dto.redFlagLevel !== undefined
          ? { redFlagLevel: dto.redFlagLevel }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });

    await this.auditService.log({
      userId,
      userRole,
      action: 'SIGN_UPDATED',
      entityName: 'Sign',
      entityId: id,
      details: {
        previous: {
          redFlagLevel: existing.redFlagLevel,
          status: existing.status,
          bodySystem: existing.bodySystem,
          active: existing.active,
        },
        updated: {
          ...(dto.redFlagLevel !== undefined
            ? { redFlagLevel: dto.redFlagLevel }
            : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.bodySystem !== undefined
            ? { bodySystem: dto.bodySystem }
            : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      },
    });

    return updated;
  }

  /**
   * Soft delete sign (active: false). Allowed for ADMIN.
   */
  async deleteSign(id: string, userId: string, userRole: string) {
    const existing = await this.prisma.sign.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Sign with id ${id} not found`);
    }

    const updated = await this.prisma.sign.update({
      where: { id },
      data: { active: false },
    });

    await this.auditService.log({
      userId,
      userRole,
      action: 'SIGN_DELETED',
      entityName: 'Sign',
      entityId: id,
      details: { name: existing.name },
    });

    return updated;
  }
}
