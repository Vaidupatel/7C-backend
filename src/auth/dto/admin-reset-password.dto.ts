import { IsNotEmpty, IsString, IsUUID, MinLength } from 'class-validator';

export class AdminResetPasswordDto {
  @IsUUID(4, { message: 'userId must be a valid UUID' })
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'Temporary password must be at least 8 characters' })
  temporaryPassword!: string;
}
