import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSignDto } from './dto/create-sign.dto.js';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async getComplaints() {
    return this.prisma.complaint.findMany({
      where: { active: true },
      include: {
        signs: {
          include: {
            sign: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getSigns() {
    return this.prisma.sign.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  async createSign(dto: CreateSignDto) {
    const sign = await this.prisma.sign.upsert({
      where: { name: dto.name },
      update: {
        bodySystem: dto.bodySystem,
        redFlagLevel: dto.redFlagLevel,
        active: true,
      },
      create: {
        name: dto.name,
        bodySystem: dto.bodySystem,
        redFlagLevel: dto.redFlagLevel,
      },
    });

    if (dto.complaintId) {
      await this.prisma.complaintSign.upsert({
        where: {
          complaintId_signId: {
            complaintId: dto.complaintId,
            signId: sign.id,
          },
        },
        update: {},
        create: {
          complaintId: dto.complaintId,
          signId: sign.id,
        },
      });
    }

    return sign;
  }
}
