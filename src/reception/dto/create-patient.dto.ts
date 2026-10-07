import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  Equals,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  Sex,
  AllergySeverity,
  MeasurementMethod,
} from '../../generated/prisma/enums.js';
import { IsNotFutureDate } from '../../common/validators/is-not-future-date.validator.js';

export class GuardianDto {
  @IsString()
  @IsNotEmpty({ message: 'Guardian name is required' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Relationship is required' })
  relationship!: string;

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phone!: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsNumber()
  @IsOptional()
  @Min(50)
  @Max(250)
  motherStatureCm?: number;

  @IsNumber()
  @IsOptional()
  @Min(50)
  @Max(250)
  fatherStatureCm?: number;

  @IsBoolean({ message: 'Consent must be a boolean value' })
  @Equals(true, { message: 'Consent must be explicitly recorded' })
  consentGiven!: boolean;

  @IsString()
  @IsOptional()
  consentPurpose?: string =
    'Pediatric outpatient care, clinical observation, and growth tracking';
}

export class AllergyInputDto {
  @IsString()
  @IsNotEmpty()
  allergen!: string;

  @IsString()
  @IsNotEmpty()
  reaction!: string;

  @IsEnum(AllergySeverity)
  severity!: AllergySeverity;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class AnthropometryInputDto {
  @IsNumber()
  @Min(0.5)
  @Max(200)
  weightKg!: number;

  @IsNumber()
  @Min(20)
  @Max(220)
  lengthOrStatureCm!: number;

  @IsEnum(MeasurementMethod)
  measurementMethod!: MeasurementMethod;

  @IsNumber()
  @IsOptional()
  @Min(20)
  @Max(70)
  headCircumferenceCm?: number;
}

export class InitialVisitInputDto {
  @IsString()
  @IsOptional()
  complaintText?: string;

  @ValidateNested()
  @Type(() => AnthropometryInputDto)
  @IsOptional()
  anthropometry?: AnthropometryInputDto;
}

export class CreatePatientDto {
  @IsString()
  @IsNotEmpty({ message: 'Patient name is required' })
  name!: string;

  @IsString()
  @IsNotEmpty({ message: 'Date of birth is required' })
  @IsNotFutureDate({ message: 'Date of birth cannot be in the future' })
  dob!: string;

  @IsEnum(Sex, { message: 'Sex must be either MALE or FEMALE' })
  sex!: Sex;

  @IsInt({ message: 'Gestational age must be an integer' })
  @IsOptional()
  @Min(20, { message: 'Gestational age must be at least 20 weeks' })
  @Max(44, { message: 'Gestational age must not exceed 44 weeks' })
  gestationalAgeWeeks?: number;

  @IsNumber()
  @IsOptional()
  @Min(0.3)
  @Max(10)
  birthWeightKg?: number;

  @IsString()
  @IsOptional()
  bloodGroup?: string;

  @ValidateNested()
  @Type(() => GuardianDto)
  @IsNotEmpty({ message: 'Guardian information is required' })
  guardian!: GuardianDto;

  @ValidateNested({ each: true })
  @Type(() => AllergyInputDto)
  @IsOptional()
  allergies?: AllergyInputDto[];

  @ValidateNested()
  @Type(() => InitialVisitInputDto)
  @IsOptional()
  visit?: InitialVisitInputDto;
}
