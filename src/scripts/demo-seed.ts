import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReceptionService } from '../reception/reception.service.js';
import { VitalsService } from '../vitals/vitals.service.js';
import { DoctorService } from '../doctor/doctor.service.js';
import {
  Sex,
  AllergySeverity,
  MeasurementMethod,
  Avpu,
  VisitStatus,
} from '../generated/prisma/enums.js';

async function runDemoSeed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run demo:seed in production mode!');
  }

  console.log('🚀 Initializing Nest application context for demo:seed...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const reception = app.get(ReceptionService);
    const vitals = app.get(VitalsService);
    const doctor = app.get(DoctorService);

    // 1. Hospital & Staff users check
    const hospital = await prisma.hospital.findUnique({
      where: { slug: '7-colour-hospital' },
    });
    if (!hospital) {
      throw new Error(
        'Hospital not found! Please run `npm run seed` first to establish foundation data.',
      );
    }

    const moUser = await prisma.user.findUnique({
      where: { email: 'mo@7colour.com' },
    });
    const receptionUser = await prisma.user.findUnique({
      where: { email: 'reception@7colour.com' },
    });
    if (!moUser || !receptionUser) {
      throw new Error(
        'Required staff accounts not found! Please run `npm run seed` first.',
      );
    }

    // 2. Lookup catalog items (Complaints & Signs)
    const complaints = await prisma.complaint.findMany();
    const signs = await prisma.sign.findMany();

    const coughComplaint = complaints.find((c) =>
      c.name.includes('Cough / Breathing Difficulty'),
    );
    const feverComplaint = complaints.find((c) => c.name.includes('Fever'));
    const poorFeedingComplaint = complaints.find((c) =>
      c.name.includes('Poor Feeding / Lethargy'),
    );
    const allergyComplaint = complaints.find((c) =>
      c.name.includes('Rash / Allergy'),
    );

    const stridorSign = signs.find((s) => s.name === 'Stridor in calm child');
    const chestIndrawingSign = signs.find((s) => s.name === 'Chest indrawing');

    // 3. Idempotent cleanup of demo patients
    const demoPatientNames = [
      'Baby Aarav Patel',
      'Mira Sharma',
      'Kabir Joshi',
      'Diya Verma',
      'Rohan Nair',
    ];
    const demoPhones = [
      '9876543210',
      '9876543211',
      '9876543212',
      '9876543213',
      '9876543214',
    ];

    console.log('🧹 Cleaning up any previous demo patients and visits...');
    const existingDemoPatients = await prisma.patient.findMany({
      where: {
        hospitalId: hospital.id,
        OR: [
          { name: { in: demoPatientNames } },
          {
            guardians: {
              some: { guardian: { phone: { in: demoPhones } } },
            },
          },
        ],
      },
      include: {
        visits: true,
      },
    });

    for (const p of existingDemoPatients) {
      for (const v of p.visits) {
        await prisma.priorityOverride.deleteMany({ where: { visitId: v.id } });
        await prisma.triageResult.deleteMany({ where: { visitId: v.id } });
        await prisma.visitSign.deleteMany({ where: { visitId: v.id } });
        await prisma.visitComplaint.deleteMany({ where: { visitId: v.id } });
        await prisma.vitalSet.deleteMany({ where: { visitId: v.id } });
        await prisma.anthropometry.deleteMany({ where: { visitId: v.id } });
        await prisma.visit.delete({ where: { id: v.id } });
      }
      await prisma.allergy.deleteMany({ where: { patientId: p.id } });
      await prisma.patientGuardian.deleteMany({ where: { patientId: p.id } });
      await prisma.patient.delete({ where: { id: p.id } });
    }

    // Clean up guardians with demo phones
    await prisma.guardian.deleteMany({
      where: { phone: { in: demoPhones } },
    });

    console.log(
      '🌱 Registering 5 synthetic demo patients through real services...',
    );

    // Archetype 1: Newborn (5 days old) - Routine checkup, normal vitals
    const now = new Date();
    const p1Dob = new Date(now.getTime() - 5 * 24 * 3600 * 1000);
    const reg1 = await reception.registerPatient(
      hospital.id,
      {
        name: 'Baby Aarav Patel',
        dob: p1Dob.toISOString().split('T')[0],
        sex: Sex.MALE,
        gestationalAgeWeeks: 39,
        birthWeightKg: 3.2,
        guardian: {
          name: 'Ramesh Patel',
          relationship: 'Father',
          phone: '9876543210',
          consentGiven: true,
          consentPurpose: 'Pediatric outpatient neonatal care',
        },
        visit: {
          complaintText: 'Routine neonatal checkup',
          anthropometry: {
            weightKg: 3.2,
            lengthOrStatureCm: 50.0,
            headCircumferenceCm: 34.5,
            measurementMethod: MeasurementMethod.RECUMBENT,
          },
        },
      },
      receptionUser.id,
    );

    if (reg1.visit) {
      await vitals.recordVitals(
        hospital.id,
        {
          visitId: reg1.visit.id,
          heartRateBpm: 135,
          respiratoryRateBpm: 42,
          spo2Percent: 98.0,
          temperatureC: 36.8,
          temperatureSite: 'Axillary',
          capillaryRefillSec: 1.5,
          avpu: Avpu.ALERT,
          complaintId: poorFeedingComplaint?.id,
          signIds: [],
        },
        moUser.id,
      );
    }

    // Archetype 2: Infant (8 months) with respiratory red flags (Emergency)
    const p2Dob = new Date(now.getTime() - 8 * 30.4375 * 24 * 3600 * 1000);
    const reg2 = await reception.registerPatient(
      hospital.id,
      {
        name: 'Mira Sharma',
        dob: p2Dob.toISOString().split('T')[0],
        sex: Sex.FEMALE,
        guardian: {
          name: 'Pooja Sharma',
          relationship: 'Mother',
          phone: '9876543211',
          consentGiven: true,
          consentPurpose: 'Pediatric emergency care and observation',
        },
        visit: {
          complaintText: 'Severe cough and difficulty breathing',
          anthropometry: {
            weightKg: 7.8,
            lengthOrStatureCm: 67.5,
            headCircumferenceCm: 43.0,
            measurementMethod: MeasurementMethod.RECUMBENT,
          },
        },
      },
      receptionUser.id,
    );

    const miraSigns = [stridorSign?.id, chestIndrawingSign?.id].filter(
      (id): id is string => !!id,
    );
    if (reg2.visit) {
      await vitals.recordVitals(
        hospital.id,
        {
          visitId: reg2.visit.id,
          heartRateBpm: 175,
          respiratoryRateBpm: 58,
          spo2Percent: 88.0,
          temperatureC: 38.8,
          temperatureSite: 'Axillary',
          capillaryRefillSec: 2.5,
          avpu: Avpu.ALERT,
          complaintId: coughComplaint?.id,
          signIds: miraSigns,
        },
        moUser.id,
      );
    }

    // Archetype 3: Toddler (18 months) with low weight-for-age (Priority)
    const p3Dob = new Date(now.getTime() - 18 * 30.4375 * 24 * 3600 * 1000);
    const reg3 = await reception.registerPatient(
      hospital.id,
      {
        name: 'Kabir Joshi',
        dob: p3Dob.toISOString().split('T')[0],
        sex: Sex.MALE,
        guardian: {
          name: 'Amit Joshi',
          relationship: 'Father',
          phone: '9876543212',
          consentGiven: true,
          consentPurpose: 'Pediatric nutrition assessment and care',
        },
        visit: {
          complaintText: 'Poor weight gain and lethargy',
          anthropometry: {
            weightKg: 7.4, // Severely underweight for 18mo boy (WAZ < -3)
            lengthOrStatureCm: 76.0,
            headCircumferenceCm: 45.0,
            measurementMethod: MeasurementMethod.RECUMBENT,
          },
        },
      },
      receptionUser.id,
    );

    if (reg3.visit) {
      await vitals.recordVitals(
        hospital.id,
        {
          visitId: reg3.visit.id,
          heartRateBpm: 110,
          respiratoryRateBpm: 28,
          spo2Percent: 98.0,
          temperatureC: 36.8,
          temperatureSite: 'Axillary',
          avpu: Avpu.ALERT,
          complaintId: poorFeedingComplaint?.id,
          signIds: [],
        },
        moUser.id,
      );
    }

    // Archetype 4: School-age child (7 years) with mild fever (Routine)
    const p4Dob = new Date(now.getTime() - 7 * 365.25 * 24 * 3600 * 1000);
    const reg4 = await reception.registerPatient(
      hospital.id,
      {
        name: 'Diya Verma',
        dob: p4Dob.toISOString().split('T')[0],
        sex: Sex.FEMALE,
        guardian: {
          name: 'Sunita Verma',
          relationship: 'Mother',
          phone: '9876543213',
          consentGiven: true,
          consentPurpose: 'Pediatric consultation for febrile illness',
        },
        visit: {
          complaintText: 'Mild fever and body ache',
          anthropometry: {
            weightKg: 22.0,
            lengthOrStatureCm: 122.0,
            measurementMethod: MeasurementMethod.STANDING,
          },
        },
      },
      receptionUser.id,
    );

    if (reg4.visit) {
      await vitals.recordVitals(
        hospital.id,
        {
          visitId: reg4.visit.id,
          heartRateBpm: 92,
          respiratoryRateBpm: 20,
          spo2Percent: 99.0,
          temperatureC: 38.1,
          temperatureSite: 'Oral',
          avpu: Avpu.ALERT,
          complaintId: feverComplaint?.id,
          signIds: [],
        },
        moUser.id,
      );
    }

    // Archetype 5: Returning follow-up patient with documented allergy
    const p5Dob = new Date(now.getTime() - 3 * 365.25 * 24 * 3600 * 1000);
    const pastVisitDate = new Date(now.getTime() - 14 * 24 * 3600 * 1000);
    const reg5 = await reception.registerPatient(
      hospital.id,
      {
        name: 'Rohan Nair',
        dob: p5Dob.toISOString().split('T')[0],
        sex: Sex.MALE,
        guardian: {
          name: 'Kavita Nair',
          relationship: 'Mother',
          phone: '9876543214',
          consentGiven: true,
          consentPurpose: 'Allergy consultation and ongoing care',
        },
        allergies: [
          {
            allergen: 'Peanuts / Groundnuts',
            reaction: 'Anaphylaxis / Acute Urticaria',
            severity: AllergySeverity.LIFE_THREATENING,
            notes: 'Requires emergency antihistamines / EpiPen',
          },
        ],
        visit: {
          complaintText: 'Initial acute allergic reaction episode',
          anthropometry: {
            weightKg: 14.5,
            lengthOrStatureCm: 95.0,
            measurementMethod: MeasurementMethod.STANDING,
          },
        },
      },
      receptionUser.id,
    );

    // Mark past visit as completed on past date
    if (reg5.visit) {
      await prisma.visit.update({
        where: { id: reg5.visit.id },
        data: {
          status: VisitStatus.COMPLETED,
          visitDate: pastVisitDate,
          visitDay: pastVisitDate,
        },
      });
    }

    // Create today's follow-up visit using createVisit
    const visit5 = await reception.createVisit(
      hospital.id,
      {
        patientId: reg5.patient.id,
        complaintText: 'Follow-up consultation after allergic reaction episode',
        anthropometry: {
          weightKg: 14.8,
          lengthOrStatureCm: 96.0,
          measurementMethod: MeasurementMethod.STANDING,
        },
      },
      receptionUser.id,
    );

    await vitals.recordVitals(
      hospital.id,
      {
        visitId: visit5.id,
        heartRateBpm: 98,
        respiratoryRateBpm: 22,
        spo2Percent: 98.0,
        temperatureC: 36.9,
        temperatureSite: 'Axillary',
        avpu: Avpu.ALERT,
        complaintId: allergyComplaint?.id,
        signIds: [],
      },
      moUser.id,
    );

    // 4. Fetch and print real computed triage queue from doctor service
    console.log('\n📊 Real computed Doctor Queue from Triage Engine:');
    const queue = await doctor.getDoctorQueue(hospital.id);

    console.table(
      queue.map((q) => ({
        Token: q.tokenNumber,
        UHID: q.uhid,
        Patient: q.name,
        Type: q.visitType,
        Level: q.effectiveLevel,
        Score: q.score,
        GrowthFlag: q.hasGrowthFlag,
        Allergies: q.allergies.length,
        Reasons: q.reasons.join('; '),
      })),
    );

    console.log(
      '\n✅ Demo seed completed successfully with real computed triage results!',
    );
  } finally {
    await app.close();
  }
}

runDemoSeed().catch((err) => {
  console.error('❌ Demo seed failed:', err);
  process.exit(1);
});
