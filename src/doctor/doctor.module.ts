import { Module } from '@nestjs/common';
import { DoctorController } from './doctor.controller.js';
import { DoctorService } from './doctor.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [DoctorController],
  providers: [DoctorService],
  exports: [DoctorService],
})
export class DoctorModule {}
