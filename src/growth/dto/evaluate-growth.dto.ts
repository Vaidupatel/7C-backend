import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Sex, MeasurementMethod } from '../../generated/prisma/enums.js';

export class EvaluateGrowthDto {
  @IsNumber()
  @Min(0)
  @Max(240)
  ageMonths!: number;

  @IsEnum(Sex)
  sex!: Sex;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(200)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(250)
  lengthOrStatureCm?: number;

  @IsOptional()
  @IsEnum(MeasurementMethod)
  measurementMethod?: MeasurementMethod;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(70)
  headCircumferenceCm?: number;

  @IsOptional()
  @IsNumber()
  fatherStatureCm?: number;

  @IsOptional()
  @IsNumber()
  motherStatureCm?: number;

  @IsOptional()
  @IsNumber()
  previousWeightPercentile?: number;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  visitId?: string;
}
