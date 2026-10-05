import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { GrowthService } from './growth.service.js';
import { EvaluateGrowthDto } from './dto/evaluate-growth.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import {
  Role,
  Sex,
  GrowthStandard,
  GrowthMeasure,
} from '../generated/prisma/enums.js';

@Controller('growth')
export class GrowthController {
  constructor(private readonly growthService: GrowthService) {}

  @Get('chart-curves')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  getChartCurves(
    @Query('measure') measure: GrowthMeasure,
    @Query('sex') sex: Sex,
    @Query('standard') standard?: GrowthStandard,
  ) {
    if (!measure || !sex) {
      throw new BadRequestException(
        'measure and sex query params are required',
      );
    }
    return this.growthService.getChartCurves(
      measure,
      sex,
      standard ?? GrowthStandard.CDC,
    );
  }

  @Post('evaluate')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  @HttpCode(HttpStatus.OK)
  async evaluateGrowth(@Body() dto: EvaluateGrowthDto) {
    return this.growthService.evaluateGrowth(dto);
  }

  @Get('lms')
  @Roles(Role.DOCTOR, Role.MEDICAL_OFFICER)
  async getLms(
    @Query('standard') standard: GrowthStandard = GrowthStandard.CDC,
    @Query('measure') measure: GrowthMeasure,
    @Query('sex') sex: Sex,
    @Query('ageMonths') ageMonthsStr: string,
  ) {
    const ageMonths = parseFloat(ageMonthsStr);
    if (isNaN(ageMonths) || !measure || !sex) {
      throw new BadRequestException('Invalid query parameters');
    }
    return this.growthService.getLms(standard, measure, sex, ageMonths);
  }
}
