import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { Role } from '../generated/prisma/enums.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // B6 fix: Use ParseIntPipe to prevent NaN, cap pagination at 100, support cursor
  @Get()
  @Roles(Role.ADMIN)
  async getLogs(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    return this.auditService.getAuditLogs(safeLimit, cursor);
  }
}
