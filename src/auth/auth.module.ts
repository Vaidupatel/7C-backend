import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { HospitalScopeGuard } from './guards/hospital-scope.guard.js';
import { MustChangePasswordGuard } from './guards/must-change-password.guard.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    HospitalScopeGuard,
    MustChangePasswordGuard,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    HospitalScopeGuard,
    MustChangePasswordGuard,
  ],
})
export class AuthModule {}
