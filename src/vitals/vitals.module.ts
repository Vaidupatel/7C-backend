import { Module } from '@nestjs/common';
import { VitalsController } from './vitals.controller.js';
import { VitalsService } from './vitals.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [VitalsController],
  providers: [VitalsService],
  exports: [VitalsService],
})
export class VitalsModule {}
