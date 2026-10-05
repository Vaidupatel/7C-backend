import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DoctorService } from './doctor.service.js';
import { OverridePriorityDto } from './dto/override-priority.dto.js';
import { UpdateVisitStatusDto } from './dto/update-visit-status.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('doctor')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Get('queue')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  async getDoctorQueue(@CurrentUser('hospitalId') hospitalId: string) {
    return this.doctorService.getDoctorQueue(hospitalId);
  }

  // B3 fix: Only DOCTOR can override priority (clinical decision)
  @Post('triage/override')
  @Roles(Role.DOCTOR)
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
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  async getPatientDetails(
    @CurrentUser('hospitalId') hospitalId: string,
    @Param('id') id: string,
  ) {
    return this.doctorService.getPatientDetails(hospitalId, id);
  }

  // C7 fix: Visit lifecycle state transitions (IN_CONSULTATION, COMPLETED, LEFT_WITHOUT_BEING_SEEN)
  @Patch('visits/:id/status')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  @HttpCode(HttpStatus.OK)
  async updateVisitStatus(
    @CurrentUser('hospitalId') hospitalId: string,
    @CurrentUser('userId') clinicianId: string,
    @Param('id') visitId: string,
    @Body() dto: UpdateVisitStatusDto,
  ) {
    return this.doctorService.updateVisitStatus(
      hospitalId,
      visitId,
      clinicianId,
      dto,
    );
  }
}
