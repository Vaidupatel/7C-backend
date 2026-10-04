import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export interface AuditLogInput {
  userId?: string;
  userRole?: string;
  action: string;
  entityName: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      // Clean details to sanitize any accidental PII or secret fields
      const sanitizedDetails = input.details
        ? this.sanitizeDetails(input.details)
        : Prisma.JsonNull;

      await this.prisma.auditLog.create({
        data: {
          userId: input.userId,
          userRole: input.userRole,
          action: input.action,
          entityName: input.entityName,
          entityId: input.entityId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          details: sanitizedDetails as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      // Audit failure should be logged but never crash the core application flow
      this.logger.error(
        `Failed to persist audit log for ${input.action} on ${input.entityName}: ${(err as Error).message}`,
      );
    }
  }

  private sanitizeDetails(
    details: Record<string, unknown>,
  ): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'accessToken',
      'authorization',
      'phone',
      'dob',
      'name',
    ];

    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      if (
        sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))
      ) {
        clean[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        clean[key] = this.sanitizeDetails(value as Record<string, unknown>);
      } else {
        clean[key] = value;
      }
    }
    return clean;
  }
}
