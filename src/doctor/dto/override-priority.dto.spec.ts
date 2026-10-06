import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { OverridePriorityDto } from './override-priority.dto.js';
import { TriageLevel } from '../../generated/prisma/enums.js';

describe('OverridePriorityDto - Validation Rules (U5)', () => {
  const validData = {
    visitId: 'visit-12345',
    overrideLevel: TriageLevel.EMERGENCY,
    reason: 'Severe respiratory distress noted on clinical inspection',
  };

  it('passes validation with valid visitId, overrideLevel, and reason >= 10 chars', async () => {
    const dto = plainToInstance(OverridePriorityDto, validData);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails validation when reason is shorter than 10 characters', async () => {
    const dto = plainToInstance(OverridePriorityDto, {
      ...validData,
      reason: 'Too short', // 9 characters
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
    expect(reasonError?.constraints?.minLength).toBe(
      'Override reason must be at least 10 characters',
    );
  });

  it('fails validation when reason is empty or whitespace', async () => {
    const dto = plainToInstance(OverridePriorityDto, {
      ...validData,
      reason: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const reasonError = errors.find((e) => e.property === 'reason');
    expect(reasonError).toBeDefined();
    expect(reasonError?.constraints?.isNotEmpty).toBe(
      'A clinical reason is mandatory to override triage priority',
    );
  });

  it('fails validation when overrideLevel is invalid enum value', async () => {
    const dto = plainToInstance(OverridePriorityDto, {
      ...validData,
      overrideLevel: 'INVALID_LEVEL',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const levelError = errors.find((e) => e.property === 'overrideLevel');
    expect(levelError).toBeDefined();
  });
});
