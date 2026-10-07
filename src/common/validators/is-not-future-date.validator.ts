import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { getZonedDateParts, HOSPITAL_TIMEZONE } from '../utils/age.util.js';

export function IsNotFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isNotFutureDate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const date = new Date(value);
          if (isNaN(date.getTime())) return false;

          const now = new Date();
          const birth = getZonedDateParts(date, HOSPITAL_TIMEZONE);
          const current = getZonedDateParts(now, HOSPITAL_TIMEZONE);
          const birthUtc = Date.UTC(birth.year, birth.month, birth.day);
          const currentUtc = Date.UTC(current.year, current.month, current.day);

          return birthUtc <= currentUtc;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} cannot be in the future`;
        },
      },
    });
  };
}
