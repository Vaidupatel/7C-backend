import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../auth/decorators/public.decorator.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async check(): Promise<{ status: string; db: string; timestamp: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'ok',
        db: 'up',
        timestamp: new Date().toISOString(),
      };
    } catch {
      return {
        status: 'error',
        db: 'down',
        timestamp: new Date().toISOString(),
      };
    }
  }
}
