import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { TriageLevel } from '../../generated/prisma/enums.js';

export class OverridePriorityDto {
  @IsString()
  @IsNotEmpty()
  visitId!: string;

  @IsEnum(TriageLevel)
  @IsNotEmpty()
  overrideLevel!: TriageLevel;

  @IsString()
  @IsNotEmpty({
    message: 'A clinical reason is mandatory to override triage priority',
  })
  reason!: string;
}
