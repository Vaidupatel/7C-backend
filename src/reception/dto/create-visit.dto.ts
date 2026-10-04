import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AnthropometryInputDto } from './create-patient.dto.js';

export class CreateVisitDto {
  @IsUUID(4, { message: 'patientId must be a valid UUID' })
  @IsNotEmpty()
  patientId!: string;

  @IsString()
  @IsOptional()
  complaintText?: string;

  @ValidateNested()
  @Type(() => AnthropometryInputDto)
  @IsOptional()
  anthropometry?: AnthropometryInputDto;
}
