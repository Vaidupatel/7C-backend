import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { VitalsService } from './vitals.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GrowthService } from '../growth/growth.service.js';
import { AuditService } from '../audit/audit.service.js';
import { VisitStatus, Sex } from '../generated/prisma/enums.js';

describe('VitalsService (F5)', () => {
  let service: VitalsService;

  const mockTx = {
    vitalSet: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    visitComplaint: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    visitSign: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    triageResult: {
      upsert: jest.fn(),
    },
    visit: {
      update: jest.fn(),
    },
  };

  const mockPrismaService = {
    visit: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    sign: {
      findMany: jest.fn(),
    },
    complaint: {
      findUnique: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation((callback: (tx: typeof mockTx) => Promise<unknown>) =>
        callback(mockTx),
      ),
  };

  const mockGrowthService = {
    evaluateGrowth: jest.fn().mockResolvedValue({
      evaluations: [],
    }),
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VitalsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: GrowthService, useValue: mockGrowthService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<VitalsService>(VitalsService);
    jest.clearAllMocks();
  });

  const hospitalId = 'hosp-123';
  const visitId = 'visit-123';
  const clinicianId = 'clinician-1';
  const mockPatient = {
    id: 'pat-1',
    dob: new Date('2024-01-01'),
    sex: Sex.MALE,
  };

  it('throws NotFoundException when visit does not exist', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue(null);

    await expect(
      service.recordVitals(hospitalId, { visitId }, clinicianId),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when visit belongs to different hospital', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId: 'other-hospital',
      patient: mockPatient,
    });

    await expect(
      service.recordVitals(hospitalId, { visitId }, clinicianId),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException when visit is in COMPLETED status', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.COMPLETED,
      patient: mockPatient,
    });

    await expect(
      service.recordVitals(hospitalId, { visitId }, clinicianId),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when visit is in LEFT_WITHOUT_BEING_SEEN status', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.LEFT_WITHOUT_BEING_SEEN,
      patient: mockPatient,
    });

    await expect(
      service.recordVitals(hospitalId, { visitId }, clinicianId),
    ).rejects.toThrow(ConflictException);
  });

  it('throws BadRequestException when unknown or inactive signIds are provided', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.REGISTERED,
      patient: mockPatient,
      visitDate: new Date(),
      createdAt: new Date(),
    });

    // Request 2 signs, but DB returns only 1 active sign
    mockPrismaService.sign.findMany.mockResolvedValue([
      { id: 'sign-1', name: 'Cough', redFlagLevel: 'NONE', active: true },
    ]);

    await expect(
      service.recordVitals(
        hospitalId,
        {
          visitId,
          signIds: ['sign-1', 'unknown-sign-2'],
        },
        clinicianId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when complaintId is invalid or inactive', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.REGISTERED,
      patient: mockPatient,
      visitDate: new Date(),
      createdAt: new Date(),
    });

    mockPrismaService.complaint.findUnique.mockResolvedValue({
      id: 'comp-1',
      active: false,
    });

    await expect(
      service.recordVitals(
        hospitalId,
        {
          visitId,
          complaintId: 'comp-1',
        },
        clinicianId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('records vitals within transaction for REGISTERED visit and transitions to WAITING_DOCTOR', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.REGISTERED,
      patient: mockPatient,
      visitDate: new Date(),
      createdAt: new Date(),
    });

    mockTx.vitalSet.create.mockResolvedValue({ id: 'vs-1', heartRateBpm: 120 });
    mockTx.triageResult.upsert.mockResolvedValue({
      id: 'tr-1',
      level: 'ROUTINE',
      score: 1000,
    });
    mockTx.visit.update.mockResolvedValue({
      id: visitId,
      status: VisitStatus.WAITING_DOCTOR,
    });

    await service.recordVitals(
      hospitalId,
      {
        visitId,
        heartRateBpm: 120,
        respiratoryRateBpm: 30,
        spo2Percent: 99,
        temperatureC: 37.0,
      },
      clinicianId,
      'MEDICAL_OFFICER',
    );

    expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.vitalSet.create).toHaveBeenCalled();
    expect(mockTx.triageResult.upsert).toHaveBeenCalled();
    expect(mockTx.visit.update).toHaveBeenCalledWith({
      where: { id: visitId },
      data: {
        status: VisitStatus.WAITING_DOCTOR,
        notes: undefined,
      },
    });
    expect(mockAuditService.log).toHaveBeenCalledWith({
      userId: clinicianId,
      userRole: 'MEDICAL_OFFICER',
      action: 'VITALS_RECORDED',
      entityName: 'Visit',
      entityId: visitId,
      details: {
        visitId,
        isReRecord: false,
        triageLevel: 'ROUTINE',
        triageScore: 1000,
      },
    });
  });

  it('supersedes previous vitals and logs VITALS_RE_RECORDED on WAITING_DOCTOR visit', async () => {
    mockPrismaService.visit.findUnique.mockResolvedValue({
      id: visitId,
      hospitalId,
      status: VisitStatus.WAITING_DOCTOR,
      patient: mockPatient,
      visitDate: new Date(),
      createdAt: new Date(),
    });

    mockTx.vitalSet.deleteMany.mockResolvedValue({ count: 1 });
    mockTx.visitSign.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.vitalSet.create.mockResolvedValue({ id: 'vs-2', heartRateBpm: 110 });
    mockTx.triageResult.upsert.mockResolvedValue({
      id: 'tr-1',
      level: 'ROUTINE',
      score: 1000,
    });
    mockTx.visit.update.mockResolvedValue({
      id: visitId,
      status: VisitStatus.WAITING_DOCTOR,
    });

    await service.recordVitals(
      hospitalId,
      {
        visitId,
        heartRateBpm: 110,
        respiratoryRateBpm: 28,
        spo2Percent: 99,
        temperatureC: 36.8,
      },
      clinicianId,
      'DOCTOR',
    );

    expect(mockTx.vitalSet.deleteMany).toHaveBeenCalledWith({
      where: { visitId },
    });
    expect(mockTx.visitSign.deleteMany).toHaveBeenCalledWith({
      where: { visitId },
    });
    expect(mockAuditService.log).toHaveBeenCalledWith({
      userId: clinicianId,
      userRole: 'DOCTOR',
      action: 'VITALS_RE_RECORDED',
      entityName: 'Visit',
      entityId: visitId,
      details: {
        visitId,
        isReRecord: true,
        triageLevel: 'ROUTINE',
        triageScore: 1000,
      },
    });
  });
});
