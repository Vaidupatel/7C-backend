import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import { CreateSignDto } from './dto/create-sign.dto.js';
import { ProposeSignDto } from './dto/propose-sign.dto.js';
import { UpdateSignDto } from './dto/update-sign.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { RequestUser } from '../auth/decorators/current-user.decorator.js';
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

  @Get('sign-proposals')
  @Roles(Role.ADMIN, Role.DOCTOR)
  async getSignProposals() {
    return this.catalogService.getSignProposals();
  }

  // B5 & F2: ADMIN creates signs with explicit red-flag level and approval
  @Post('signs')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async createSign(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateSignDto,
  ) {
    return this.catalogService.createSign(dto, user.userId);
  }

  // F2: MO and DOCTOR propose signs inline (forces NONE red flag and PENDING_DOCTOR_APPROVAL)
  @Post('sign-proposals')
  @Roles(Role.MEDICAL_OFFICER, Role.DOCTOR)
  @HttpCode(HttpStatus.CREATED)
  async proposeSign(
    @CurrentUser() user: RequestUser,
    @Body() dto: ProposeSignDto,
  ) {
    return this.catalogService.proposeSign(dto, user.userId, user.role);
  }

  // F2: ADMIN or DOCTOR approves, updates redFlagLevel, or edits a sign
  @Patch('signs/:id')
  @Roles(Role.ADMIN, Role.DOCTOR)
  @HttpCode(HttpStatus.OK)
  async updateSign(
    @Param('id') id: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateSignDto,
  ) {
    return this.catalogService.updateSign(id, dto, user.userId, user.role);
  }

  // F2: ADMIN soft deletes a sign
  @Delete('signs/:id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async deleteSign(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.catalogService.deleteSign(id, user.userId, user.role);
  }
}
