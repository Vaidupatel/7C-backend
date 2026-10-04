import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { RequestUser } from '../decorators/current-user.decorator.js';

@Injectable()
export class HospitalScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: RequestUser;
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();

    const user = request.user;
    if (!user) {
      return true; // Let authentication guard handle missing user
    }

    const requestedHospitalId =
      request.params?.['hospitalId'] ||
      request.query?.['hospitalId'] ||
      (request.body?.['hospitalId'] as string | undefined);

    if (requestedHospitalId && requestedHospitalId !== user.hospitalId) {
      throw new ForbiddenException(
        'Access denied: You cannot access or modify records from another hospital',
      );
    }

    return true;
  }
}
