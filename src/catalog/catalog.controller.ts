import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CreateSignDto } from './dto/create-sign.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('complaints')
  @Roles(Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getComplaints() {
    return this.catalogService.getComplaints();
  }

  @Get('signs')
  @Roles(Role.RECEPTIONIST, Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getSigns() {
    return this.catalogService.getSigns();
  }

  @Post('signs')
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createSign(@Body() dto: CreateSignDto) {
    return this.catalogService.createSign(dto);
  }
}
