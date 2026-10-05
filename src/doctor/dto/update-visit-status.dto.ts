import { IsEnum, IsOptional, IsString } from 'class-validator';
import { VisitStatus } from '../../generated/prisma/enums.js';

export class UpdateVisitStatusDto {
  @IsEnum(VisitStatus)
  status!: VisitStatus;

  @IsString()
  @IsOptional()
  notes?: string;
}
