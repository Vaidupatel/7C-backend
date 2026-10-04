import { Module } from '@nestjs/common';
import { ReceptionService } from './reception.service.js';
import { ReceptionController } from './reception.controller.js';

@Module({
  controllers: [ReceptionController],
  providers: [ReceptionService],
  exports: [ReceptionService],
})
export class ReceptionModule {}
