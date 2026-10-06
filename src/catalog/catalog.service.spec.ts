import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ApprovalStatus, RedFlagLevel } from '../generated/prisma/enums.js';

describe('CatalogService - Sign Proposals and Governance (F2)', () => {
  let service: CatalogService;

  const mockPrismaService = {
    complaint: {
      findMany: jest.fn(),
    },
    sign: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    complaintSign: {
      upsert: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
    jest.clearAllMocks();
  });

  describe('proposeSign', () => {
    it('creates a new sign with PENDING_DOCTOR_APPROVAL and redFlagLevel NONE', async () => {
      const dto = {
        name: 'Stridor on exertion',
        bodySystem: 'RESPIRATORY',
        complaintId: 'comp-123',
      };
      const userId = 'user-mo-1';
      const userRole = 'MEDICAL_OFFICER';

      mockPrismaService.sign.upsert.mockResolvedValueOnce({
        id: 'sign-new-1',
        name: dto.name,
        bodySystem: dto.bodySystem,
        redFlagLevel: RedFlagLevel.NONE,
        status: ApprovalStatus.PENDING_DOCTOR_APPROVAL,
        proposedByUserId: userId,
        active: true,
      });

      mockPrismaService.complaintSign.upsert.mockResolvedValueOnce({});

      const result = await service.proposeSign(dto, userId, userRole);

      expect(result.id).toBe('sign-new-1');
      expect(result.redFlagLevel).toBe(RedFlagLevel.NONE);
      expect(result.status).toBe(ApprovalStatus.PENDING_DOCTOR_APPROVAL);

      expect(mockPrismaService.sign.upsert).toHaveBeenCalledWith({
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

      expect(mockPrismaService.complaintSign.upsert).toHaveBeenCalled();
      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId,
        userRole,
        action: 'SIGN_PROPOSED',
        entityName: 'Sign',
        entityId: 'sign-new-1',
        details: {
          name: dto.name,
          bodySystem: dto.bodySystem,
          complaintId: dto.complaintId,
        },
      });
    });
  });

  describe('updateSign', () => {
    it('throws NotFoundException if sign does not exist', async () => {
      mockPrismaService.sign.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateSign(
          'non-existent',
          { redFlagLevel: RedFlagLevel.EMERGENCY },
          'user-admin',
          'ADMIN',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates redFlagLevel and status, and audits previous and new values', async () => {
      const existing = {
        id: 'sign-1',
        name: 'Severe wheezing',
        bodySystem: 'RESPIRATORY',
        redFlagLevel: RedFlagLevel.NONE,
        status: ApprovalStatus.PENDING_DOCTOR_APPROVAL,
        active: true,
      };

      mockPrismaService.sign.findUnique.mockResolvedValueOnce(existing);
      mockPrismaService.sign.update.mockResolvedValueOnce({
        ...existing,
        redFlagLevel: RedFlagLevel.EMERGENCY,
        status: ApprovalStatus.APPROVED,
      });

      const updated = await service.updateSign(
        'sign-1',
        {
          redFlagLevel: RedFlagLevel.EMERGENCY,
          status: ApprovalStatus.APPROVED,
        },
        'user-doc',
        'DOCTOR',
      );

      expect(updated.redFlagLevel).toBe(RedFlagLevel.EMERGENCY);
      expect(updated.status).toBe(ApprovalStatus.APPROVED);

      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId: 'user-doc',
        userRole: 'DOCTOR',
        action: 'SIGN_UPDATED',
        entityName: 'Sign',
        entityId: 'sign-1',
        details: {
          previous: {
            redFlagLevel: RedFlagLevel.NONE,
            status: ApprovalStatus.PENDING_DOCTOR_APPROVAL,
            bodySystem: 'RESPIRATORY',
            active: true,
          },
          updated: {
            redFlagLevel: RedFlagLevel.EMERGENCY,
            status: ApprovalStatus.APPROVED,
          },
        },
      });
    });
  });

  describe('deleteSign', () => {
    it('soft deletes a sign and audits SIGN_DELETED', async () => {
      mockPrismaService.sign.findUnique.mockResolvedValueOnce({
        id: 'sign-1',
        name: 'Deprecated sign',
        active: true,
      });
      mockPrismaService.sign.update.mockResolvedValueOnce({
        id: 'sign-1',
        active: false,
      });

      await service.deleteSign('sign-1', 'admin-id', 'ADMIN');

      expect(mockPrismaService.sign.update).toHaveBeenCalledWith({
        where: { id: 'sign-1' },
        data: { active: false },
      });
      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId: 'admin-id',
        userRole: 'ADMIN',
        action: 'SIGN_DELETED',
        entityName: 'Sign',
        entityId: 'sign-1',
        details: { name: 'Deprecated sign' },
      });
    });
  });
});
