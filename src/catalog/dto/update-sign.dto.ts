import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { RedFlagLevel, ApprovalStatus } from '../../generated/prisma/enums.js';

export class UpdateSignDto {
  @IsString()
  @IsOptional()
  bodySystem?: string;

  @IsEnum(RedFlagLevel)
  @IsOptional()
  redFlagLevel?: RedFlagLevel;

  @IsEnum(ApprovalStatus)
  @IsOptional()
  status?: ApprovalStatus;

  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
