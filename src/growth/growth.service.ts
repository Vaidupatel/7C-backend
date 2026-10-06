import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  calculateLmsZScore,
  zScoreToPercentile,
  calculateLmsValue,
  calculateMidParentalHeight,
  evaluateGrowthFlag,
  detectPercentileCrossing,
  LmsParams,
  GrowthEvaluationResult,
  MidParentalHeightResult,
  PercentileCrossingResult,
} from '../common/utils/growth.util.js';
import {
  Sex,
  GrowthStandard,
  GrowthMeasure,
} from '../generated/prisma/enums.js';
import { EvaluateGrowthDto } from './dto/evaluate-growth.dto.js';

export class GrowthDataUnavailableException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrowthDataUnavailableException';
  }
}

export const GROWTH_POLICY = {
  defaultInfantStandard: GrowthStandard.WHO, // 0 to <24 months
  defaultChildStandard: GrowthStandard.CDC, // 24 to 240 months
  status: 'PENDING_DOCTOR_APPROVAL',
  citation:
    'CDC/AAP published recommendation: WHO Child Growth Standards (0-<24 months), CDC Growth Charts (2-20 years)',
};

export interface CurvePoint {
  ageMonths: number;
  l?: number;
  m?: number;
  s?: number;
  p3: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p85?: number | null;
  p90: number;
  p95: number;
  p97: number;
}

export interface GrowthEvaluationFullResponse {
  ageMonths: number;
  sex: Sex;
  standardUsed: GrowthStandard;
  policyCitation: string;
  evaluations: GrowthEvaluationResult[];
  percentileCrossing?: PercentileCrossingResult;
  midParentalHeight: MidParentalHeightResult | null;
  overallGrowthSeverity: 'NORMAL' | 'PRIORITY' | 'EMERGENCY';
  summaryRemarks: string[];
}

@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves LMS parameters for standard, measure, sex, and age coordinate.
   * Performs exact match or linear interpolation between real adjacent imported rows.
   * Throws GrowthDataUnavailableException outside the dataset bounds (never clamps or fakes).
   */
  async getLms(
    standard: GrowthStandard,
    measure: GrowthMeasure,
    sex: Sex,
    ageMonths: number,
  ): Promise<LmsParams> {
    // 1. Check for exact match (within floating point precision tolerance)
    const exact = await this.prisma.growthReference.findFirst({
      where: {
        standard,
        measure,
        sex,
        ageMonths: {
          gte: ageMonths - 0.001,
          lte: ageMonths + 0.001,
        },
      },
    });

    if (exact) {
      return { l: exact.l, m: exact.m, s: exact.s };
    }

    // 2. Query adjacent bounds for linear interpolation
    const [lower, upper] = await Promise.all([
      this.prisma.growthReference.findFirst({
        where: {
          standard,
          measure,
          sex,
          ageMonths: { lte: ageMonths },
        },
        orderBy: { ageMonths: 'desc' },
      }),
      this.prisma.growthReference.findFirst({
        where: {
          standard,
          measure,
          sex,
          ageMonths: { gte: ageMonths },
        },
        orderBy: { ageMonths: 'asc' },
      }),
    ]);

    if (!lower || !upper) {
      throw new GrowthDataUnavailableException(
        `No reference growth data for ${standard} ${measure} ${sex} at age/metric ${ageMonths}. Valid domain not found.`,
      );
    }

    if (lower.ageMonths === upper.ageMonths) {
      return { l: lower.l, m: lower.m, s: lower.s };
    }

    // Linear interpolation between the two real reference points
    const t =
      (ageMonths - lower.ageMonths) / (upper.ageMonths - lower.ageMonths);
    const l = lower.l + t * (upper.l - lower.l);
    const m = lower.m + t * (upper.m - lower.m);
    const s = lower.s + t * (upper.s - lower.s);

    return { l, m, s };
  }

  /**
   * Evaluates patient anthropometry against WHO/CDC policy.
   */
  async evaluateGrowth(
    dto: EvaluateGrowthDto,
  ): Promise<GrowthEvaluationFullResponse> {
    const isInfant = dto.ageMonths < 24;
    const policyStandard = isInfant
      ? GROWTH_POLICY.defaultInfantStandard
      : GROWTH_POLICY.defaultChildStandard;

    const evaluations: GrowthEvaluationResult[] = [];
    const summaryRemarks: string[] = [];
    let overallSeverity: 'NORMAL' | 'PRIORITY' | 'EMERGENCY' = 'NORMAL';

    const bumpSeverity = (sev: 'NORMAL' | 'PRIORITY' | 'EMERGENCY') => {
      if (sev === 'EMERGENCY') {
        overallSeverity = 'EMERGENCY';
      } else if (sev === 'PRIORITY' && overallSeverity !== 'EMERGENCY') {
        overallSeverity = 'PRIORITY';
      }
    };

    // 1. Weight Evaluation
    let currentWeightPct: number | undefined;
    if (dto.weightKg != null && dto.weightKg > 0) {
      try {
        const wLms = await this.getLms(
          policyStandard,
          GrowthMeasure.WEIGHT_FOR_AGE,
          dto.sex,
          dto.ageMonths,
        );
        const { zScore, isExtreme, isImplausible } = calculateLmsZScore(
          dto.weightKg,
          wLms,
        );
        const percentile = zScoreToPercentile(zScore);
        currentWeightPct = percentile;

        const flag = evaluateGrowthFlag('WEIGHT_FOR_AGE', zScore, percentile);
        bumpSeverity(flag.severity);
        if (flag.clinicalFlag) summaryRemarks.push(flag.clinicalFlag);

        evaluations.push({
          measure: 'WEIGHT_FOR_AGE',
          value: dto.weightKg,
          zScore,
          percentile,
          isExtreme,
          isImplausible,
          clinicalFlag: flag.clinicalFlag,
          severity: flag.severity,
        });
      } catch {
        evaluations.push({
          measure: 'WEIGHT_FOR_AGE',
          value: dto.weightKg,
          zScore: 0,
          percentile: 0,
          isExtreme: false,
          clinicalFlag: 'NOT_EVALUATED (Outside reference tables)',
          severity: 'NORMAL',
        });
      }
    }

    // 2. Length/Stature Evaluation
    if (dto.lengthOrStatureCm != null && dto.lengthOrStatureCm > 0) {
      const lenMeasure = isInfant
        ? GrowthMeasure.LENGTH_FOR_AGE
        : GrowthMeasure.STATURE_FOR_AGE;
      try {
        const sLms = await this.getLms(
          policyStandard,
          lenMeasure,
          dto.sex,
          dto.ageMonths,
        );
        const { zScore, isExtreme, isImplausible } = calculateLmsZScore(
          dto.lengthOrStatureCm,
          sLms,
        );
        const percentile = zScoreToPercentile(zScore);

        const flag = evaluateGrowthFlag(lenMeasure, zScore, percentile);
        bumpSeverity(flag.severity);
        if (flag.clinicalFlag) summaryRemarks.push(flag.clinicalFlag);

        evaluations.push({
          measure: lenMeasure,
          value: dto.lengthOrStatureCm,
          zScore,
          percentile,
          isExtreme,
          isImplausible,
          clinicalFlag: flag.clinicalFlag,
          severity: flag.severity,
        });
      } catch {
        evaluations.push({
          measure: lenMeasure,
          value: dto.lengthOrStatureCm,
          zScore: 0,
          percentile: 0,
          isExtreme: false,
          clinicalFlag: 'NOT_EVALUATED (Outside reference tables)',
          severity: 'NORMAL',
        });
      }

      // 3. BMI-for-Age (Children >= 24 months, CDC)
      if (
        !isInfant &&
        dto.weightKg != null &&
        dto.weightKg > 0 &&
        dto.ageMonths >= 24
      ) {
        const heightM = dto.lengthOrStatureCm / 100;
        const bmi = Math.round((dto.weightKg / (heightM * heightM)) * 10) / 10;
        try {
          const bmiLms = await this.getLms(
            GrowthStandard.CDC,
            GrowthMeasure.BMI_FOR_AGE,
            dto.sex,
            dto.ageMonths,
          );
          const bmiRes = calculateLmsZScore(bmi, bmiLms);
          const bmiPct = zScoreToPercentile(bmiRes.zScore);
          const bmiFlag = evaluateGrowthFlag(
            'BMI_FOR_AGE',
            bmiRes.zScore,
            bmiPct,
          );
          bumpSeverity(bmiFlag.severity);
          if (bmiFlag.clinicalFlag) summaryRemarks.push(bmiFlag.clinicalFlag);

          evaluations.push({
            measure: 'BMI_FOR_AGE',
            value: bmi,
            zScore: bmiRes.zScore,
            percentile: bmiPct,
            isExtreme: bmiRes.isExtreme,
            isImplausible: bmiRes.isImplausible,
            clinicalFlag: bmiFlag.clinicalFlag,
            severity: bmiFlag.severity,
          });
        } catch {
          evaluations.push({
            measure: 'BMI_FOR_AGE',
            value: bmi,
            zScore: 0,
            percentile: 0,
            isExtreme: false,
            clinicalFlag: 'NOT_EVALUATED (Outside BMI reference tables)',
            severity: 'NORMAL',
          });
        }
      }

      // 4. Weight-for-Length (Infants < 24 months, CDC length coordinate 45-103.5cm)
      if (
        isInfant &&
        dto.weightKg != null &&
        dto.weightKg > 0 &&
        dto.lengthOrStatureCm >= 45 &&
        dto.lengthOrStatureCm <= 103.5
      ) {
        try {
          const wflLms = await this.getLms(
            GrowthStandard.CDC,
            GrowthMeasure.WEIGHT_FOR_LENGTH,
            dto.sex,
            dto.lengthOrStatureCm,
          );
          const wflRes = calculateLmsZScore(dto.weightKg, wflLms);
          const wflPct = zScoreToPercentile(wflRes.zScore);
          const wflFlag = evaluateGrowthFlag(
            'WEIGHT_FOR_LENGTH',
            wflRes.zScore,
            wflPct,
          );
          bumpSeverity(wflFlag.severity);
          if (wflFlag.clinicalFlag) summaryRemarks.push(wflFlag.clinicalFlag);

          evaluations.push({
            measure: 'WEIGHT_FOR_LENGTH',
            value: dto.weightKg,
            zScore: wflRes.zScore,
            percentile: wflPct,
            isExtreme: wflRes.isExtreme,
            isImplausible: wflRes.isImplausible,
            clinicalFlag: wflFlag.clinicalFlag,
            severity: wflFlag.severity,
          });
        } catch {
          // outside domain
        }
      }
    }

    // 5. Head Circumference Evaluation (infants and young children <= 36 months)
    if (
      dto.headCircumferenceCm != null &&
      dto.headCircumferenceCm > 0 &&
      dto.ageMonths <= 36
    ) {
      try {
        const hcLms = await this.getLms(
          policyStandard,
          GrowthMeasure.HEAD_CIRCUMFERENCE_FOR_AGE,
          dto.sex,
          dto.ageMonths,
        );
        const hcRes = calculateLmsZScore(dto.headCircumferenceCm, hcLms);
        const hcPct = zScoreToPercentile(hcRes.zScore);
        const hcFlag = evaluateGrowthFlag(
          'HEAD_CIRCUMFERENCE_FOR_AGE',
          hcRes.zScore,
          hcPct,
        );
        bumpSeverity(hcFlag.severity);
        if (hcFlag.clinicalFlag) summaryRemarks.push(hcFlag.clinicalFlag);

        evaluations.push({
          measure: 'HEAD_CIRCUMFERENCE_FOR_AGE',
          value: dto.headCircumferenceCm,
          zScore: hcRes.zScore,
          percentile: hcPct,
          isExtreme: hcRes.isExtreme,
          isImplausible: hcRes.isImplausible,
          clinicalFlag: hcFlag.clinicalFlag,
          severity: hcFlag.severity,
        });
      } catch {
        evaluations.push({
          measure: 'HEAD_CIRCUMFERENCE_FOR_AGE',
          value: dto.headCircumferenceCm,
          zScore: 0,
          percentile: 0,
          isExtreme: false,
          clinicalFlag: 'NOT_EVALUATED (Outside reference tables)',
          severity: 'NORMAL',
        });
      }
    }

    // 6. Percentile Channel Crossing Trend Detection
    let crossingResult: PercentileCrossingResult | undefined;
    if (currentWeightPct != null && dto.previousWeightPercentile != null) {
      crossingResult = detectPercentileCrossing(
        dto.previousWeightPercentile,
        currentWeightPct,
      );
      if (crossingResult.crossed) {
        bumpSeverity(crossingResult.severity);
        if (crossingResult.clinicalFlag) {
          summaryRemarks.push(crossingResult.clinicalFlag);
        }
      }
    }

    // 7. Mid-Parental Height Calculation
    const midParentalHeight = calculateMidParentalHeight(
      dto.sex,
      dto.fatherStatureCm,
      dto.motherStatureCm,
    );

    return {
      ageMonths: dto.ageMonths,
      sex: dto.sex,
      standardUsed: policyStandard,
      policyCitation: GROWTH_POLICY.citation,
      evaluations,
      percentileCrossing: crossingResult,
      midParentalHeight,
      overallGrowthSeverity: overallSeverity,
      summaryRemarks,
    };
  }

  /**
   * Returns dense curve points straight from the GrowthReference table for Recharts.
   */
  async getChartCurves(
    measure: GrowthMeasure,
    sex: Sex,
    standard: GrowthStandard = GrowthStandard.CDC,
  ): Promise<CurvePoint[]> {
    const records = await this.prisma.growthReference.findMany({
      where: {
        standard,
        measure,
        sex,
      },
      orderBy: {
        ageMonths: 'asc',
      },
    });

    if (records.length === 0 && standard === GrowthStandard.WHO) {
      // Fallback to CDC if measure is only present in CDC (e.g. STATURE or BMI)
      const cdcRecords = await this.prisma.growthReference.findMany({
        where: {
          standard: GrowthStandard.CDC,
          measure,
          sex,
        },
        orderBy: {
          ageMonths: 'asc',
        },
      });
      return cdcRecords.map((item) => this.mapRecordToCurvePoint(item));
    }

    return records.map((item) => this.mapRecordToCurvePoint(item));
  }

  private mapRecordToCurvePoint(item: {
    ageMonths: number;
    l: number;
    m: number;
    s: number;
    p3: number | null;
    p5: number | null;
    p10: number | null;
    p25: number | null;
    p50: number | null;
    p75: number | null;
    p85: number | null;
    p90: number | null;
    p95: number | null;
    p97: number | null;
  }): CurvePoint {
    const lms: LmsParams = { l: item.l, m: item.m, s: item.s };
    return {
      ageMonths: item.ageMonths,
      l: item.l,
      m: item.m,
      s: item.s,
      p3: item.p3 ?? calculateLmsValue(-1.881, lms),
      p5: item.p5 ?? calculateLmsValue(-1.645, lms),
      p10: item.p10 ?? calculateLmsValue(-1.282, lms),
      p25: item.p25 ?? calculateLmsValue(-0.674, lms),
      p50: item.p50 ?? calculateLmsValue(0, lms),
      p75: item.p75 ?? calculateLmsValue(0.674, lms),
      p85: item.p85,
      p90: item.p90 ?? calculateLmsValue(1.282, lms),
      p95: item.p95 ?? calculateLmsValue(1.645, lms),
      p97: item.p97 ?? calculateLmsValue(1.881, lms),
    };
  }
}
