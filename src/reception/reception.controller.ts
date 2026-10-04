import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReceptionService } from './reception.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { HospitalScopeGuard } from '../auth/guards/hospital-scope.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('reception')
@UseGuards(JwtAuthGuard, RolesGuard, HospitalScopeGuard)
export class ReceptionController {
  constructor(private readonly receptionService: ReceptionService) {}

  @Post('patients')
  @Roles(Role.RECEPTIONIST, Role.ADMIN, Role.MEDICAL_OFFICER, Role.DOCTOR)
  @HttpCode(HttpStatus.CREATED)
  async registerPatient(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreatePatientDto,
  ) {
    return this.receptionService.registerPatient(
      user.hospitalId,
      dto,
      user.userId,
    );
  }

  @Get('patients/search')
  @Roles(Role.RECEPTIONIST, Role.ADMIN, Role.MEDICAL_OFFICER, Role.DOCTOR)
  async searchPatients(
    @CurrentUser('hospitalId') hospitalId: string,
    @Query('query') query: string,
  ) {
    return this.receptionService.searchPatients(hospitalId, query || '');
  }

  @Get('patients/:id')
  @Roles(Role.RECEPTIONIST, Role.ADMIN, Role.MEDICAL_OFFICER, Role.DOCTOR)
  async getPatientDetails(
    @CurrentUser('hospitalId') hospitalId: string,
    @Param('id') id: string,
  ) {
    return this.receptionService.getPatientDetails(hospitalId, id);
  }

  @Post('visits')
  @Roles(Role.RECEPTIONIST, Role.ADMIN, Role.MEDICAL_OFFICER, Role.DOCTOR)
  @HttpCode(HttpStatus.CREATED)
  async createVisit(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVisitDto,
  ) {
    return this.receptionService.createVisit(user.hospitalId, dto, user.userId);
  }

  @Get('today-visits')
  @Roles(Role.RECEPTIONIST, Role.ADMIN, Role.MEDICAL_OFFICER, Role.DOCTOR)
  async getTodayVisits(@CurrentUser('hospitalId') hospitalId: string) {
    return this.receptionService.getTodayVisits(hospitalId);
  }
}
