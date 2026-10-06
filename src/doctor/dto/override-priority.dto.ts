import { IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
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
  @MinLength(10, {
    message: 'Override reason must be at least 10 characters',
  })
  reason!: string;
}
