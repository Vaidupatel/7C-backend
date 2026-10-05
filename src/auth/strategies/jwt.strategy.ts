import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RequestUser } from '../decorators/current-user.decorator.js';
import { Role } from '../../generated/prisma/enums.js';

interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  hospitalId: string;
  name: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is required');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      algorithms: ['HS256'], // Security item 26: pin algorithm to HS256, reject none
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        hospitalId: true,
        active: true,
        mustChangePassword: true,
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User account is inactive or not found');
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
