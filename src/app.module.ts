import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { MustChangePasswordGuard } from './auth/guards/must-change-password.guard.js';
import { HealthModule } from './health/health.module.js';
import { ReceptionModule } from './reception/reception.module.js';
import { GrowthModule } from './growth/growth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { VitalsModule } from './vitals/vitals.module.js';
import { DoctorModule } from './doctor/doctor.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.passwordHash',
            'req.body.token',
            'req.body.refreshToken',
            'req.body.phone',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
      },
    }),
    // Security Check 28: Global rate limit configuration (generous 300 req/min for clinical UI & polling)
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 300,
      },
    ]),
    PrismaModule,
    AuditModule,
    AuthModule,
    HealthModule,
    ReceptionModule,
    GrowthModule,
    CatalogModule,
    VitalsModule,
    DoctorModule,
  ],
  providers: [
    // Security Check 28: Register ThrottlerGuard globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // B1 fix: Default-deny JWT auth — all endpoints require auth unless @Public()
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // B1 fix: Default-deny roles — all endpoints require @Roles() unless @Public()
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // A9 fix: Block mustChangePassword users from non-auth endpoints
    {
      provide: APP_GUARD,
      useClass: MustChangePasswordGuard,
    },
  ],
})
export class AppModule {}
