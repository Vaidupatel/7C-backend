import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReceptionService } from './reception.service.js';
import { CreatePatientDto } from './dto/create-patient.dto.js';
import { CreateVisitDto } from './dto/create-visit.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('reception')
export class ReceptionController {
  constructor(private readonly receptionService: ReceptionService) {}

  // B2 fix: Only RECEPTIONIST can register patients
  @Post('patients')
  @Roles(Role.RECEPTIONIST)
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

  // All clinical roles can search patients (demographics only)
  @Get('patients/search')
  @Roles(Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async searchPatients(
    @CurrentUser('hospitalId') hospitalId: string,
    @Query('query') query: string,
  ) {
    return this.receptionService.searchPatients(hospitalId, query || '');
  }

  @Get('patients/:id')
  @Roles(Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR)
  async getPatientDetails(
    @CurrentUser('hospitalId') hospitalId: string,
    @Param('id') id: string,
  ) {
    return this.receptionService.getPatientDetails(hospitalId, id);
  }

  // B2 fix: Only RECEPTIONIST can create visits
  @Post('visits')
  @Roles(Role.RECEPTIONIST)
  @HttpCode(HttpStatus.CREATED)
  async createVisit(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateVisitDto,
  ) {
    return this.receptionService.createVisit(user.hospitalId, dto, user.userId);
  }

  @Get('today-visits')
  @Roles(Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getTodayVisits(@CurrentUser('hospitalId') hospitalId: string) {
    return this.receptionService.getTodayVisits(hospitalId);
  }
}
