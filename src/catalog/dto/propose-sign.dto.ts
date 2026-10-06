import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ProposeSignDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  bodySystem!: string;

  @IsString()
  @IsOptional()
  complaintId?: string;
}
