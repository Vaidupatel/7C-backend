import { Module } from '@nestjs/common';
import { VitalsController } from './vitals.controller.js';
import { VitalsService } from './vitals.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { GrowthModule } from '../growth/growth.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [PrismaModule, GrowthModule, AuditModule],
  controllers: [VitalsController],
  providers: [VitalsService],
  exports: [VitalsService],
})
export class VitalsModule {}
