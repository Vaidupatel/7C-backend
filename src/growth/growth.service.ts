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
import { CDC_REFERENCE_DATA, getBuiltinLms } from './cdc-reference-data.js';

export interface CurvePoint {
  ageMonths: number;
  p3: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p97: number;
}

export interface GrowthEvaluationFullResponse {
  ageMonths: number;
  sex: Sex;
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
   * Retrieves LMS parameters for standard, measure, sex, and age.
   * Checks database table first; falls back to verified built-in CDC data.
   */
  async getLms(
    standard: GrowthStandard,
    measure: GrowthMeasure,
    sex: Sex,
    ageMonths: number,
  ): Promise<LmsParams> {
    const dbRef = await this.prisma.growthReference.findFirst({
      where: {
        standard,
        measure,
        sex,
        ageMonths: {
          lte: ageMonths + 0.5,
          gte: Math.max(0, ageMonths - 0.5),
        },
      },
      orderBy: {
        ageMonths: 'asc',
      },
    });

    if (dbRef) {
      return { l: dbRef.l, m: dbRef.m, s: dbRef.s };
    }

    // Built-in verified CDC lookup
    return getBuiltinLms(standard, measure, sex, ageMonths);
  }

  /**
   * Evaluates patient anthropometry against CDC/WHO standards.
   */
  async evaluateGrowth(
    dto: EvaluateGrowthDto,
  ): Promise<GrowthEvaluationFullResponse> {
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
      const wLms = await this.getLms(
        GrowthStandard.CDC,
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
    }

    // 2. Stature/Length Evaluation
    if (dto.lengthOrStatureCm != null && dto.lengthOrStatureCm > 0) {
      const isInfant = dto.ageMonths < 24;
      const measure = isInfant
        ? GrowthMeasure.LENGTH_FOR_AGE
        : GrowthMeasure.STATURE_FOR_AGE;
      const sLms = await this.getLms(
        GrowthStandard.CDC,
        measure,
        dto.sex,
        dto.ageMonths,
      );
      const { zScore, isExtreme, isImplausible } = calculateLmsZScore(
        dto.lengthOrStatureCm,
        sLms,
      );
      const percentile = zScoreToPercentile(zScore);

      const flag = evaluateGrowthFlag(measure, zScore, percentile);
      bumpSeverity(flag.severity);
      if (flag.clinicalFlag) summaryRemarks.push(flag.clinicalFlag);

      evaluations.push({
        measure,
        value: dto.lengthOrStatureCm,
        zScore,
        percentile,
        isExtreme,
        isImplausible,
        clinicalFlag: flag.clinicalFlag,
        severity: flag.severity,
      });

      // 3. BMI Calculation if height and weight are provided
      if (dto.weightKg != null && dto.weightKg > 0) {
        const heightM = dto.lengthOrStatureCm / 100;
        const bmi = Math.round((dto.weightKg / (heightM * heightM)) * 10) / 10;
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
      }
    }

    // 4. Head Circumference Evaluation (infants up to 36 months)
    if (
      dto.headCircumferenceCm != null &&
      dto.headCircumferenceCm > 0 &&
      dto.ageMonths <= 36
    ) {
      const hcLms = await this.getLms(
        GrowthStandard.CDC,
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
    }

    // 5. Percentile Channel Crossing Trend Detection
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

    // 6. Mid-Parental Height Calculation
    const midParentalHeight = calculateMidParentalHeight(
      dto.sex,
      dto.fatherStatureCm,
      dto.motherStatureCm,
    );

    return {
      ageMonths: dto.ageMonths,
      sex: dto.sex,
      evaluations,
      percentileCrossing: crossingResult,
      midParentalHeight,
      overallGrowthSeverity: overallSeverity,
      summaryRemarks,
    };
  }

  /**
   * Returns CDC standard curve points for Recharts plotting on frontend.
   */
  getChartCurves(
    measure: GrowthMeasure,
    sex: Sex,
    standard: GrowthStandard = GrowthStandard.CDC,
  ): CurvePoint[] {
    void standard;
    const list = CDC_REFERENCE_DATA[sex]?.[measure] || [];
    return list.map((item) => {
      const lms: LmsParams = { l: item.l, m: item.m, s: item.s };
      return {
        ageMonths: item.ageMonths,
        p3: item.p3 ?? calculateLmsValue(-1.881, lms),
        p5: item.p5 ?? calculateLmsValue(-1.645, lms),
        p10: item.p10 ?? calculateLmsValue(-1.282, lms),
        p25: item.p25 ?? calculateLmsValue(-0.674, lms),
        p50: item.p50 ?? calculateLmsValue(0, lms),
        p75: item.p75 ?? calculateLmsValue(0.674, lms),
        p90: item.p90 ?? calculateLmsValue(1.282, lms),
        p95: item.p95 ?? calculateLmsValue(1.645, lms),
        p97: item.p97 ?? calculateLmsValue(1.881, lms),
      };
    });
  }
}
