import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DoctorService, ALLOWED_VISIT_TRANSITIONS } from './doctor.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VisitStatus } from '../generated/prisma/enums.js';

describe('DoctorService - Visit State Machine (F1)', () => {
  let service: DoctorService;

  const mockPrismaService = {
    visit: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    priorityOverride: {
      create: jest.fn(),
    },
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DoctorService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<DoctorService>(DoctorService);
    jest.clearAllMocks();
  });

  describe('ALLOWED_VISIT_TRANSITIONS map', () => {
    it('defines valid legal progressions', () => {
      expect(ALLOWED_VISIT_TRANSITIONS[VisitStatus.REGISTERED]).toContain(
        VisitStatus.WAITING_DOCTOR,
      );
      expect(ALLOWED_VISIT_TRANSITIONS[VisitStatus.WAITING_DOCTOR]).toEqual([
        VisitStatus.IN_CONSULTATION,
        VisitStatus.LEFT_WITHOUT_BEING_SEEN,
      ]);
      expect(ALLOWED_VISIT_TRANSITIONS[VisitStatus.IN_CONSULTATION]).toEqual([
        VisitStatus.COMPLETED,
        VisitStatus.LEFT_WITHOUT_BEING_SEEN,
      ]);
      expect(ALLOWED_VISIT_TRANSITIONS[VisitStatus.COMPLETED]).toEqual([]);
      expect(
        ALLOWED_VISIT_TRANSITIONS[VisitStatus.LEFT_WITHOUT_BEING_SEEN],
      ).toEqual([]);
    });
  });

  describe('updateVisitStatus', () => {
    const hospitalId = 'hosp-123';
    const visitId = 'visit-abc';
    const clinicianId = 'user-doc-1';
    const clinicianRole = 'DOCTOR';

    it('throws NotFoundException if visit does not exist or hospitalId mismatches', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.updateVisitStatus(
          hospitalId,
          visitId,
          clinicianId,
          clinicianRole,
          { status: VisitStatus.IN_CONSULTATION },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException (409) when attempting illegal transition: WAITING_DOCTOR -> COMPLETED', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce({
        id: visitId,
        hospitalId,
        status: VisitStatus.WAITING_DOCTOR,
      });

      await expect(
        service.updateVisitStatus(
          hospitalId,
          visitId,
          clinicianId,
          clinicianRole,
          { status: VisitStatus.COMPLETED },
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.visit.update).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('throws ConflictException (409) when attempting transition from terminal COMPLETED state', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce({
        id: visitId,
        hospitalId,
        status: VisitStatus.COMPLETED,
      });

      await expect(
        service.updateVisitStatus(
          hospitalId,
          visitId,
          clinicianId,
          clinicianRole,
          { status: VisitStatus.IN_CONSULTATION },
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.visit.update).not.toHaveBeenCalled();
    });

    it('successfully transitions WAITING_DOCTOR -> IN_CONSULTATION and logs audit', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce({
        id: visitId,
        hospitalId,
        status: VisitStatus.WAITING_DOCTOR,
      });
      mockPrismaService.visit.update.mockResolvedValueOnce({
        id: visitId,
        status: VisitStatus.IN_CONSULTATION,
      });

      const result = await service.updateVisitStatus(
        hospitalId,
        visitId,
        clinicianId,
        clinicianRole,
        { status: VisitStatus.IN_CONSULTATION },
      );

      expect(result.status).toBe(VisitStatus.IN_CONSULTATION);
      expect(mockPrismaService.visit.update).toHaveBeenCalledWith({
        where: { id: visitId },
        data: { status: VisitStatus.IN_CONSULTATION },
      });
      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId: clinicianId,
        userRole: clinicianRole,
        action: 'VISIT_STATUS_TRANSITION',
        entityName: 'Visit',
        entityId: visitId,
        details: {
          previousStatus: VisitStatus.WAITING_DOCTOR,
          newStatus: VisitStatus.IN_CONSULTATION,
          notes: undefined,
        },
      });
    });

    it('successfully transitions IN_CONSULTATION -> COMPLETED with clinical notes', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce({
        id: visitId,
        hospitalId,
        status: VisitStatus.IN_CONSULTATION,
      });
      mockPrismaService.visit.update.mockResolvedValueOnce({
        id: visitId,
        status: VisitStatus.COMPLETED,
        notes: 'Prescribed oral rehydration and amoxicillin',
      });

      const result = await service.updateVisitStatus(
        hospitalId,
        visitId,
        clinicianId,
        clinicianRole,
        {
          status: VisitStatus.COMPLETED,
          notes: 'Prescribed oral rehydration and amoxicillin',
        },
      );

      expect(result.status).toBe(VisitStatus.COMPLETED);
      expect(mockPrismaService.visit.update).toHaveBeenCalledWith({
        where: { id: visitId },
        data: {
          status: VisitStatus.COMPLETED,
          notes: 'Prescribed oral rehydration and amoxicillin',
        },
      });
      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId: clinicianId,
        userRole: clinicianRole,
        action: 'VISIT_STATUS_TRANSITION',
        entityName: 'Visit',
        entityId: visitId,
        details: {
          previousStatus: VisitStatus.IN_CONSULTATION,
          newStatus: VisitStatus.COMPLETED,
          notes: 'Prescribed oral rehydration and amoxicillin',
        },
      });
    });

    it('successfully transitions to LEFT_WITHOUT_BEING_SEEN from WAITING_DOCTOR', async () => {
      mockPrismaService.visit.findUnique.mockResolvedValueOnce({
        id: visitId,
        hospitalId,
        status: VisitStatus.WAITING_DOCTOR,
      });
      mockPrismaService.visit.update.mockResolvedValueOnce({
        id: visitId,
        status: VisitStatus.LEFT_WITHOUT_BEING_SEEN,
      });

      const result = await service.updateVisitStatus(
        hospitalId,
        visitId,
        clinicianId,
        clinicianRole,
        { status: VisitStatus.LEFT_WITHOUT_BEING_SEEN },
      );

      expect(result.status).toBe(VisitStatus.LEFT_WITHOUT_BEING_SEEN);
      expect(mockAuditService.log).toHaveBeenCalledWith({
        userId: clinicianId,
        userRole: clinicianRole,
        action: 'VISIT_STATUS_TRANSITION',
        entityName: 'Visit',
        entityId: visitId,
        details: {
          previousStatus: VisitStatus.WAITING_DOCTOR,
          newStatus: VisitStatus.LEFT_WITHOUT_BEING_SEEN,
          notes: undefined,
        },
      });
    });
  });

  describe('getDoctorQueue (F6)', () => {
    const hospitalId = 'hosp-123';

    it('returns NOT_TRIAGED with score 2500 when visit has no triageResult (safety bias)', async () => {
      const untriagedVisit = {
        id: 'v-untriaged',
        patient: {
          id: 'p-1',
          uhid: '7C-2026-00001',
          name: 'Untriaged Child',
          dob: new Date('2024-01-01'),
          sex: 'MALE',
          allergies: [],
        },
        anthropometry: null,
        vitals: [],
        signs: [],
        complaints: [],
        triageResult: null,
        priorityOverrides: [],
        visitType: 'NEW',
        tokenNumber: 1,
        status: VisitStatus.WAITING_DOCTOR,
        createdAt: new Date(),
      };

      const routineVisit = {
        id: 'v-routine',
        patient: {
          id: 'p-2',
          uhid: '7C-2026-00002',
          name: 'Routine Child',
          dob: new Date('2024-01-01'),
          sex: 'FEMALE',
          allergies: [],
        },
        anthropometry: null,
        vitals: [],
        signs: [],
        complaints: [],
        triageResult: {
          level: 'ROUTINE',
          score: 1000,
          reasons: ['Normal vitals'],
          configVersion: '2026.1-peds-opd',
        },
        priorityOverrides: [],
        visitType: 'NEW',
        tokenNumber: 2,
        status: VisitStatus.WAITING_DOCTOR,
        createdAt: new Date(),
      };

      mockPrismaService.visit.findMany.mockResolvedValueOnce([
        untriagedVisit,
        routineVisit,
      ]);

      const queue = await service.getDoctorQueue(hospitalId);

      expect(queue).toHaveLength(2);
      const untriaged = queue.find((q) => q.visitId === 'v-untriaged');
      expect(untriaged).toBeDefined();
      expect(untriaged?.effectiveLevel).toBe('NOT_TRIAGED');
      expect(untriaged?.originalLevel).toBe('NOT_TRIAGED');
      expect(untriaged?.score).toBe(2500);
      expect(untriaged?.reasons).toContain(
        'Pending clinical vitals & triage evaluation',
      );

      // Verify NOT_TRIAGED (score 2500) sorts above ROUTINE (score 1000)
      const routine = queue.find((q) => q.visitId === 'v-routine');
      expect(routine?.score).toBe(1000);
      expect(untriaged?.score).toBeGreaterThan(routine!.score);
    });
  });
});
