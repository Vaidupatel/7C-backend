import { validate } from 'class-validator';
import { IsNotFutureDate } from './is-not-future-date.validator.js';

class TestDto {
  @IsNotFutureDate()
  dob!: string;
}

describe('IsNotFutureDate Validator', () => {
  it('passes for today or past dates', async () => {
    const dto = new TestDto();
    dto.dob = '2020-01-01';
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails for future dates', async () => {
    const dto = new TestDto();
    dto.dob = '2099-01-01';
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isNotFutureDate).toBe(
      'dob cannot be in the future',
    );
  });

  it('fails for invalid date strings', async () => {
    const dto = new TestDto();
    dto.dob = 'not-a-date';
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
  });
});
