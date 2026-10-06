import { Test, TestingModule } from '@nestjs/testing';
import {
  GrowthService,
  GrowthDataUnavailableException,
} from './growth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  GrowthStandard,
  GrowthMeasure,
  Sex,
} from '../generated/prisma/enums.js';

describe('GrowthService', () => {
  let service: GrowthService;

  const mockPrismaService = {
    growthReference: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GrowthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<GrowthService>(GrowthService);
    jest.clearAllMocks();
  });

  describe('getLms exact lookup and linear interpolation', () => {
    it('returns exact match when coordinate matches exactly', async () => {
      mockPrismaService.growthReference.findFirst.mockResolvedValueOnce({
        ageMonths: 9.5,
        l: -0.1600954,
        m: 9.476500305,
        s: 0.11218624,
      });

      const lms = await service.getLms(
        GrowthStandard.CDC,
        GrowthMeasure.WEIGHT_FOR_AGE,
        Sex.MALE,
        9.5,
      );

      expect(lms.l).toBeCloseTo(-0.1600954, 5);
      expect(lms.m).toBeCloseTo(9.476500305, 5);
      expect(lms.s).toBeCloseTo(0.11218624, 5);
    });

    it('interpolates linearly when age is between two real reference rows', async () => {
      // No exact match
      mockPrismaService.growthReference.findFirst
        .mockResolvedValueOnce(null) // exact check
        .mockResolvedValueOnce({
          ageMonths: 9.5,
          l: -0.16,
          m: 9.47,
          s: 0.11,
        }) // lower bound
        .mockResolvedValueOnce({
          ageMonths: 10.5,
          l: -0.18,
          m: 9.77,
          s: 0.11,
        }); // upper bound

      const lms = await service.getLms(
        GrowthStandard.CDC,
        GrowthMeasure.WEIGHT_FOR_AGE,
        Sex.MALE,
        10.0,
      );

      // Halfway between 9.5 and 10.5 (t = 0.5)
      expect(lms.l).toBeCloseTo(-0.17, 3);
      expect(lms.m).toBeCloseTo(9.62, 2);
      expect(lms.s).toBeCloseTo(0.11, 2);
    });

    it('throws GrowthDataUnavailableException outside dataset bounds (never clamps)', async () => {
      // Lower exists, upper does not (age beyond max table age)
      mockPrismaService.growthReference.findFirst
        .mockResolvedValueOnce(null) // exact check
        .mockResolvedValueOnce({
          ageMonths: 240,
          l: -0.5,
          m: 70,
          s: 0.15,
        })
        .mockResolvedValueOnce(null); // upper null -> outside bounds

      await expect(
        service.getLms(
          GrowthStandard.CDC,
          GrowthMeasure.WEIGHT_FOR_AGE,
          Sex.MALE,
          250,
        ),
      ).rejects.toThrow(GrowthDataUnavailableException);
    });
  });

  describe('evaluateGrowth and GROWTH_POLICY', () => {
    it('applies WHO standard for infants under 24 months per policy', async () => {
      mockPrismaService.growthReference.findFirst.mockResolvedValue({
        ageMonths: 6,
        l: 0.2,
        m: 7.9,
        s: 0.12,
      });

      const result = await service.evaluateGrowth({
        ageMonths: 6,
        sex: Sex.MALE,
        weightKg: 8.0,
      });

      expect(result.standardUsed).toBe(GrowthStandard.WHO);
      expect(result.policyCitation).toContain(
        'WHO Child Growth Standards (0-<24 months)',
      );
      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].measure).toBe('WEIGHT_FOR_AGE');
    });

    it('applies CDC standard for children 24 months and older', async () => {
      mockPrismaService.growthReference.findFirst.mockResolvedValue({
        ageMonths: 36,
        l: -0.3,
        m: 14.5,
        s: 0.13,
      });

      const result = await service.evaluateGrowth({
        ageMonths: 36,
        sex: Sex.FEMALE,
        weightKg: 14.5,
      });

      expect(result.standardUsed).toBe(GrowthStandard.CDC);
      expect(result.policyCitation).toContain('CDC Growth Charts (2-20 years)');
      expect(result.evaluations[0].measure).toBe('WEIGHT_FOR_AGE');
    });

    it('surfaces NOT_EVALUATED when measurement is outside domain', async () => {
      // Return null so getLms throws GrowthDataUnavailableException
      mockPrismaService.growthReference.findFirst.mockResolvedValue(null);

      const result = await service.evaluateGrowth({
        ageMonths: 6,
        sex: Sex.MALE,
        weightKg: 8.0,
      });

      expect(result.evaluations).toHaveLength(1);
      expect(result.evaluations[0].clinicalFlag).toContain('NOT_EVALUATED');
    });
  });

  describe('getChartCurves', () => {
    it('returns dense records from GrowthReference without sparse faking', async () => {
      mockPrismaService.growthReference.findMany.mockResolvedValueOnce([
        {
          ageMonths: 0,
          l: 0.3,
          m: 3.3,
          s: 0.14,
          p3: 2.4,
          p5: 2.6,
          p10: 2.8,
          p25: 3.0,
          p50: 3.3,
          p75: 3.7,
          p85: null,
          p90: 4.0,
          p95: 4.2,
          p97: 4.4,
        },
        {
          ageMonths: 1,
          l: 0.2,
          m: 4.5,
          s: 0.13,
          p3: 3.4,
          p5: 3.6,
          p10: 3.8,
          p25: 4.1,
          p50: 4.5,
          p75: 4.9,
          p85: null,
          p90: 5.3,
          p95: 5.5,
          p97: 5.8,
        },
      ]);

      const curves = await service.getChartCurves(
        GrowthMeasure.WEIGHT_FOR_AGE,
        Sex.MALE,
        GrowthStandard.WHO,
      );

      expect(curves).toHaveLength(2);
      expect(curves[0].ageMonths).toBe(0);
      expect(curves[0].p50).toBe(3.3);
      expect(curves[1].ageMonths).toBe(1);
      expect(curves[1].p50).toBe(4.5);
    });
  });
});
