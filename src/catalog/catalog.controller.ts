import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CreateSignDto } from './dto/create-sign.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('complaints')
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getComplaints() {
    return this.catalogService.getComplaints();
  }

  @Get('signs')
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR, Role.ADMIN)
  async getSigns() {
    return this.catalogService.getSigns();
  }

  // B5: Only ADMIN can create/edit signs (red-flag level changes affect triage)
  @Post('signs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createSign(@Body() dto: CreateSignDto) {
    return this.catalogService.createSign(dto);
  }
}
