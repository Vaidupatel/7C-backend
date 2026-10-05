import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Role } from '../../generated/prisma/enums.js';

export interface RequestUser {
  userId: string;
  email: string;
  role: Role;
  hospitalId: string;
  name: string;
  mustChangePassword: boolean;
}

export const CurrentUser = createParamDecorator(
  (data: keyof RequestUser | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user?: RequestUser }>();
    const user = request.user;
    if (!user) {
      return null;
    }
    return data ? user[data] : user;
  },
);
