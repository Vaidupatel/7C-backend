import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Avpu } from '../../generated/prisma/enums.js';

export class RecordVitalsDto {
  @IsString()
  @IsNotEmpty()
  visitId!: string;

  @IsNumber()
  @IsOptional()
  @Min(30)
  @Max(300)
  heartRateBpm?: number;

  @IsNumber()
  @IsOptional()
  @Min(5)
  @Max(120)
  respiratoryRateBpm?: number;

  @IsNumber()
  @IsOptional()
  @Min(30)
  @Max(250)
  bpSystolic?: number;

  @IsNumber()
  @IsOptional()
  @Min(20)
  @Max(150)
  bpDiastolic?: number;

  @IsNumber()
  @IsOptional()
  @Min(40)
  @Max(100)
  spo2Percent?: number;

  @IsNumber()
  @IsOptional()
  @Min(30.0)
  @Max(45.0)
  temperatureC?: number;

  @IsString()
  @IsOptional()
  temperatureSite?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  painScore?: number;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(15.0)
  capillaryRefillSec?: number;

  @IsEnum(Avpu)
  @IsOptional()
  avpu?: Avpu;

  @IsString()
  @IsOptional()
  complaintId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  signIds?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}
