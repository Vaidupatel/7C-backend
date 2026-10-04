import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { RedFlagLevel } from '../../generated/prisma/enums.js';

export class CreateSignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  bodySystem!: string;

  @IsEnum(RedFlagLevel)
  @IsOptional()
  redFlagLevel?: RedFlagLevel = RedFlagLevel.NONE;

  @IsString()
  @IsOptional()
  complaintId?: string;
}
