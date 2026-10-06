import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreatePatientDto } from './create-patient.dto.js';
import { Sex } from '../../generated/prisma/enums.js';

describe('CreatePatientDto - Consent & Gestational Age Validation (F3)', () => {
  const baseValidData = {
    name: 'Aarav Sharma',
    dob: '2024-01-15',
    sex: Sex.MALE,
    guardian: {
      name: 'Priya Sharma',
      relationship: 'Mother',
      phone: '+919876543210',
      consentGiven: true,
    },
  };

  it('passes validation when consentGiven is explicitly true and gestationalAgeWeeks is omitted', async () => {
    const dto = plainToInstance(CreatePatientDto, baseValidData);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.gestationalAgeWeeks).toBeUndefined();
  });

  it('fails validation when consentGiven is false', async () => {
    const data = {
      ...baseValidData,
      guardian: {
        ...baseValidData.guardian,
        consentGiven: false,
      },
    };
    const dto = plainToInstance(CreatePatientDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const guardianError = errors.find((e) => e.property === 'guardian');
    expect(guardianError).toBeDefined();
    const consentError = guardianError?.children?.find(
      (c) => c.property === 'consentGiven',
    );
    expect(consentError).toBeDefined();
    expect(consentError?.constraints?.equals).toBe(
      'Consent must be explicitly recorded',
    );
  });

  it('fails validation when consentGiven is omitted', async () => {
    const data = {
      ...baseValidData,
      guardian: {
        name: 'Priya Sharma',
        relationship: 'Mother',
        phone: '+919876543210',
      },
    };
    const dto = plainToInstance(CreatePatientDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const guardianError = errors.find((e) => e.property === 'guardian');
    expect(guardianError).toBeDefined();
  });

  it('accepts valid gestationalAgeWeeks within [20, 44]', async () => {
    const data = {
      ...baseValidData,
      gestationalAgeWeeks: 34,
    };
    const dto = plainToInstance(CreatePatientDto, data);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.gestationalAgeWeeks).toBe(34);
  });

  it('rejects gestationalAgeWeeks less than 20 or greater than 44', async () => {
    const dataLow = { ...baseValidData, gestationalAgeWeeks: 18 };
    const dtoLow = plainToInstance(CreatePatientDto, dataLow);
    const errorsLow = await validate(dtoLow);
    expect(errorsLow.some((e) => e.property === 'gestationalAgeWeeks')).toBe(
      true,
    );

    const dataHigh = { ...baseValidData, gestationalAgeWeeks: 45 };
    const dtoHigh = plainToInstance(CreatePatientDto, dataHigh);
    const errorsHigh = await validate(dtoHigh);
    expect(errorsHigh.some((e) => e.property === 'gestationalAgeWeeks')).toBe(
      true,
    );
  });

  it('rejects non-integer gestationalAgeWeeks', async () => {
    const dataFloat = { ...baseValidData, gestationalAgeWeeks: 37.5 };
    const dtoFloat = plainToInstance(CreatePatientDto, dataFloat);
    const errorsFloat = await validate(dtoFloat);
    expect(errorsFloat.some((e) => e.property === 'gestationalAgeWeeks')).toBe(
      true,
    );
  });
});
