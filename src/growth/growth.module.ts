import { Module } from '@nestjs/common';
import { GrowthController } from './growth.controller.js';
import { GrowthService } from './growth.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
