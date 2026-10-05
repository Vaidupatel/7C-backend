import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

interface LoginResponseBody {
  accessToken: string;
}

interface RegisterResponseBody {
  patient: {
    id: string;
    uhid: string;
    name: string;
  };
  visit?: {
    id: string;
    tokenNumber: number;
    visitType: string;
  };
}

interface VisitResponseBody {
  id: string;
  tokenNumber: number;
  visitType: string;
}

interface PatientDetailsResponseBody {
  id: string;
  name: string;
  age: {
    formattedAge: string;
    years: number;
    months: number;
  };
  allergies: Array<{ allergen: string }>;
  guardians: Array<{
    guardian: {
      name: string;
      motherStatureCm?: number;
      fatherStatureCm?: number;
    };
  }>;
}

describe('Reception & Intake Module (e2e)', () => {
  let app: INestApplication<App>;
  let receptionistToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // Clean up any residual test patients respecting onDelete: Restrict
    const prisma = app.get(PrismaService);
    const cleanTestPatients = async (prismaClient: PrismaService) => {
      const testPatients = await prismaClient.patient.findMany({
        where: {
          name: {
            in: ['Aarav Kumar', 'Concurrent Child 1', 'Concurrent Child 2'],
          },
        },
        select: { id: true },
      });
      const patientIds = testPatients.map((p) => p.id);
      if (patientIds.length > 0) {
        const visits = await prismaClient.visit.findMany({
          where: { patientId: { in: patientIds } },
          select: { id: true },
        });
        const visitIds = visits.map((v) => v.id);
        if (visitIds.length > 0) {
          await prismaClient.anthropometry.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.vitalSet.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.visitSign.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.visitComplaint.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.triageResult.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.priorityOverride.deleteMany({
            where: { visitId: { in: visitIds } },
          });
          await prismaClient.visit.deleteMany({
            where: { id: { in: visitIds } },
          });
        }
        await prismaClient.allergy.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prismaClient.patientGuardian.deleteMany({
          where: { patientId: { in: patientIds } },
        });
        await prismaClient.patient.deleteMany({
          where: { id: { in: patientIds } },
        });
      }
    };
    await cleanTestPatients(prisma);

    // Login as receptionist
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: 'reception@7colour.com',
        password: 'Reception@7Colour2026!',
      });
    receptionistToken = (loginRes.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    const prisma = app.get(PrismaService);
    const testPatients = await prisma.patient.findMany({
      where: {
        name: {
          in: ['Aarav Kumar', 'Concurrent Child 1', 'Concurrent Child 2'],
        },
      },
      select: { id: true },
    });
    const patientIds = testPatients.map((p) => p.id);
    if (patientIds.length > 0) {
      const visits = await prisma.visit.findMany({
        where: { patientId: { in: patientIds } },
        select: { id: true },
      });
      const visitIds = visits.map((v) => v.id);
      if (visitIds.length > 0) {
        await prisma.anthropometry.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.vitalSet.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.visitSign.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.visitComplaint.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.triageResult.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.priorityOverride.deleteMany({
          where: { visitId: { in: visitIds } },
        });
        await prisma.visit.deleteMany({
          where: { id: { in: visitIds } },
        });
      }
      await prisma.allergy.deleteMany({
        where: { patientId: { in: patientIds } },
      });
      await prisma.patientGuardian.deleteMany({
        where: { patientId: { in: patientIds } },
      });
      await prisma.patient.deleteMany({
        where: { id: { in: patientIds } },
      });
    }
    await app.close();
  });

  it('registers a new patient with guardian, consent, allergies, and anthropometry', async () => {
    const testPatient = {
      name: 'Aarav Kumar',
      dob: '2024-01-15',
      sex: 'MALE',
      gestationalAgeWeeks: 40,
      birthWeightKg: 3.2,
      bloodGroup: 'B+',
      guardian: {
        name: 'Suresh Kumar',
        relationship: 'Father',
        phone: '+91 98765 43210',
        motherStatureCm: 162.5,
        fatherStatureCm: 175.0,
        consentGiven: true,
        consentPurpose: 'Pediatric care and growth tracking',
      },
      allergies: [
        {
          allergen: 'Amoxicillin',
          reaction: 'Skin rash',
          severity: 'MODERATE',
        },
      ],
      visit: {
        complaintText: 'Cough and mild fever for 2 days',
        anthropometry: {
          weightKg: 11.5,
          lengthOrStatureCm: 84.0,
          measurementMethod: 'RECUMBENT',
          headCircumferenceCm: 47.0,
        },
      },
    };

    const res = await request(app.getHttpServer())
      .post('/api/reception/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(testPatient)
      .expect(201);

    const body = res.body as RegisterResponseBody;
    expect(body.patient).toBeDefined();
    expect(body.patient.uhid).toMatch(/^7C-\d{4}-\d{5}$/);
    expect(body.visit).toBeDefined();
    expect(body.visit?.visitType).toBe('NEW');
    expect(body.visit?.tokenNumber).toBeGreaterThan(0);
  });

  it('detects duplicate patient and returns 409 Conflict', async () => {
    const duplicatePayload = {
      name: 'Aarav Kumar',
      dob: '2024-01-15',
      sex: 'MALE',
      guardian: {
        name: 'Suresh Kumar',
        relationship: 'Father',
        phone: '+91 98765 43210',
      },
    };

    const res = await request(app.getHttpServer())
      .post('/api/reception/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send(duplicatePayload)
      .expect(409);

    expect(JSON.stringify(res.body)).toContain('already exists');
  });

  it('searches patient by name, UHID, or phone', async () => {
    const searchByName = await request(app.getHttpServer())
      .get('/api/reception/patients/search?query=Aarav')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .expect(200);

    expect(Array.isArray(searchByName.body)).toBe(true);
    expect((searchByName.body as unknown[]).length).toBeGreaterThan(0);

    const searchByPhone = await request(app.getHttpServer())
      .get('/api/reception/patients/search?query=98765')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .expect(200);

    expect((searchByPhone.body as unknown[]).length).toBeGreaterThan(0);
  });

  it('retrieves patient details with computed age and parental heights', async () => {
    const searchRes = await request(app.getHttpServer())
      .get('/api/reception/patients/search?query=Aarav')
      .set('Authorization', `Bearer ${receptionistToken}`);

    const patientId = (searchRes.body as Array<{ id: string }>)[0].id;

    const detailsRes = await request(app.getHttpServer())
      .get(`/api/reception/patients/${patientId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .expect(200);

    const body = detailsRes.body as PatientDetailsResponseBody;
    expect(body.name).toBe('Aarav Kumar');
    expect(body.age).toBeDefined();
    expect(body.age.formattedAge).toBeDefined();
    expect(body.allergies.length).toBe(1);
    expect(body.allergies[0].allergen).toBe('Amoxicillin');
    expect(body.guardians[0].guardian.motherStatureCm).toBe(162.5);
    expect(body.guardians[0].guardian.fatherStatureCm).toBe(175.0);
  });

  it('marks follow-up visit correctly when patient already has visits', async () => {
    const searchRes = await request(app.getHttpServer())
      .get('/api/reception/patients/search?query=Aarav')
      .set('Authorization', `Bearer ${receptionistToken}`);

    const patientId = (searchRes.body as Array<{ id: string }>)[0].id;

    const followUpRes = await request(app.getHttpServer())
      .post('/api/reception/visits')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        patientId,
        complaintText: 'Follow-up check after 2 days',
      })
      .expect(201);

    const body = followUpRes.body as VisitResponseBody;
    expect(body.visitType).toBe('FOLLOW_UP');
    expect(body.tokenNumber).toBeGreaterThan(1);
  });

  it('guarantees concurrency safety: parallel visit creations receive distinct sequential tokens', async () => {
    // Create two new unique test patients first
    const p1Res = await request(app.getHttpServer())
      .post('/api/reception/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        name: 'Concurrent Child 1',
        dob: '2023-05-10',
        sex: 'FEMALE',
        guardian: {
          name: 'Parent 1',
          relationship: 'Mother',
          phone: '+91 99999 11111',
        },
      });

    const p2Res = await request(app.getHttpServer())
      .post('/api/reception/patients')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .send({
        name: 'Concurrent Child 2',
        dob: '2023-06-12',
        sex: 'MALE',
        guardian: {
          name: 'Parent 2',
          relationship: 'Father',
          phone: '+91 99999 22222',
        },
      });

    const p1Id = (p1Res.body as RegisterResponseBody).patient.id;
    const p2Id = (p2Res.body as RegisterResponseBody).patient.id;

    // Send two visit requests concurrently
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/reception/visits')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ patientId: p1Id }),
      request(app.getHttpServer())
        .post('/api/reception/visits')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ patientId: p2Id }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const token1 = (res1.body as VisitResponseBody).tokenNumber;
    const token2 = (res2.body as VisitResponseBody).tokenNumber;

    // Must be distinct tokens
    expect(token1).not.toBe(token2);
    expect(Math.abs(token1 - token2)).toBe(1);
  });
});
