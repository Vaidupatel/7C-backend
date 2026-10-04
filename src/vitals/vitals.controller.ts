import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VitalsService } from './vitals.service.js';
import { RecordVitalsDto } from './dto/record-vitals.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { HospitalScopeGuard } from '../auth/guards/hospital-scope.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('vitals')
@UseGuards(JwtAuthGuard, RolesGuard, HospitalScopeGuard)
export class VitalsController {
  constructor(private readonly vitalsService: VitalsService) {}

  @Get('queue')
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getNeedsVitalsQueue(@CurrentUser('hospitalId') hospitalId: string) {
    return this.vitalsService.getNeedsVitalsQueue(hospitalId);
  }

  @Post()
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async recordVitals(
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordVitalsDto,
  ) {
    return this.vitalsService.recordVitals(user.hospitalId, dto, user.userId);
  }
}
