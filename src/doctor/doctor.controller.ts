import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DoctorService } from './doctor.service.js';
import { OverridePriorityDto } from './dto/override-priority.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { HospitalScopeGuard } from '../auth/guards/hospital-scope.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('doctor')
@UseGuards(JwtAuthGuard, RolesGuard, HospitalScopeGuard)
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get('queue')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER, Role.ADMIN)
  async getDoctorQueue(@CurrentUser('hospitalId') hospitalId: string) {
    return this.doctorService.getDoctorQueue(hospitalId);
  }

  @Post('triage/override')
  @Roles(Role.DOCTOR, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async overridePriority(
    @CurrentUser() user: RequestUser,
    @Body() dto: OverridePriorityDto,
  ) {
    return this.doctorService.overridePriority(
      user.hospitalId,
      user.userId,
      user.email,
      dto,
    );
  }

  @Get('patients/:id')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER, Role.ADMIN)
  async getPatientDetails(
    @CurrentUser('hospitalId') hospitalId: string,
    @Param('id') id: string,
  ) {
    return this.doctorService.getPatientDetails(hospitalId, id);
  }
}
