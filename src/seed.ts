import { PrismaClient } from './generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required for seeding');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seed() {
  console.log('Seeding 7 Colour HMS database...');

  // 1. Hospital
  const hospital = await prisma.hospital.upsert({
    where: { slug: '7-colour-hospital' },
    update: {},
    create: {
      name: '7 Colour Pediatric Hospital',
      slug: '7-colour-hospital',
      address: '123 Healthway Avenue, Ahmedabad, Gujarat',
      phone: '+91 79 2345 6789',
    },
  });
  console.log(`Hospital ready: ${hospital.name} (${hospital.id})`);

  // 2. Passwords (Security Checklist 30)
  if (process.env.NODE_ENV === 'production') {
    if (
      !process.env.INITIAL_ADMIN_PASSWORD ||
      !process.env.DEMO_DOCTOR_PASSWORD ||
      !process.env.DEMO_RECEPTION_PASSWORD ||
      !process.env.DEMO_MO_PASSWORD
    ) {
      throw new Error(
        'Refusing to seed in production without explicit strong passwords for all staff accounts in environment variables!',
      );
    }
  }

  const adminPassword =
    process.env.INITIAL_ADMIN_PASSWORD ||
    crypto.randomBytes(12).toString('base64');
  const demoDoctorPassword =
    process.env.DEMO_DOCTOR_PASSWORD ||
    crypto.randomBytes(12).toString('base64');
  const demoReceptionPassword =
    process.env.DEMO_RECEPTION_PASSWORD ||
    crypto.randomBytes(12).toString('base64');
  const demoMoPassword =
    process.env.DEMO_MO_PASSWORD || crypto.randomBytes(12).toString('base64');

  console.log('--- CREDENTIALS NOTICE (Shown during seed only) ---');
  console.log(`Admin User: admin@7colour.com | Password: ${adminPassword}`);
  console.log(
    `Doctor User: doctor@7colour.com | Password: ${demoDoctorPassword}`,
  );
  console.log(
    `Receptionist: reception@7colour.com | Password: ${demoReceptionPassword}`,
  );
  console.log(`Medical Officer: mo@7colour.com | Password: ${demoMoPassword}`);
  console.log('----------------------------------------------------');

  const adminHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  });
  const doctorHash = await argon2.hash(demoDoctorPassword, {
    type: argon2.argon2id,
  });
  const receptionHash = await argon2.hash(demoReceptionPassword, {
    type: argon2.argon2id,
  });
  const moHash = await argon2.hash(demoMoPassword, {
    type: argon2.argon2id,
  });

  // Upsert Users
  await prisma.user.upsert({
    where: { email: 'admin@7colour.com' },
    update: { passwordHash: adminHash },
    create: {
      email: 'admin@7colour.com',
      name: 'Dr. System Administrator',
      passwordHash: adminHash,
      role: 'ADMIN',
      hospitalId: hospital.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'doctor@7colour.com' },
    update: { passwordHash: doctorHash },
    create: {
      email: 'doctor@7colour.com',
      name: 'Dr. A. Mehta (Pediatrician)',
      passwordHash: doctorHash,
      role: 'DOCTOR',
      hospitalId: hospital.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'reception@7colour.com' },
    update: { passwordHash: receptionHash },
    create: {
      email: 'reception@7colour.com',
      name: 'R. Sharma (Receptionist)',
      passwordHash: receptionHash,
      role: 'RECEPTIONIST',
      hospitalId: hospital.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'mo@7colour.com' },
    update: { passwordHash: moHash },
    create: {
      email: 'mo@7colour.com',
      name: 'Dr. K. Patel (Medical Officer)',
      passwordHash: moHash,
      role: 'MEDICAL_OFFICER',
      hospitalId: hospital.id,
    },
  });

  // 3. Clinical Data: Vital Ranges (Clinical Rule 5: Cited sources, PENDING_DOCTOR_APPROVAL)
  const vitalRanges = [
    // Heart Rate (WHO Pocket Book of Hospital Care for Children 2013 / PALS 2020)
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 0,
      maxAgeMonths: 1,
      lowCritical: 80,
      lowNormal: 100,
      highNormal: 180,
      highCritical: 205,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 1,
      maxAgeMonths: 12,
      lowCritical: 70,
      lowNormal: 100,
      highNormal: 160,
      highCritical: 180,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 12,
      maxAgeMonths: 36,
      lowCritical: 60,
      lowNormal: 90,
      highNormal: 150,
      highCritical: 165,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 36,
      maxAgeMonths: 72,
      lowCritical: 60,
      lowNormal: 80,
      highNormal: 140,
      highCritical: 150,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 72,
      maxAgeMonths: 144,
      lowCritical: 50,
      lowNormal: 70,
      highNormal: 120,
      highCritical: 135,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },
    {
      vitalName: 'HEART_RATE',
      minAgeMonths: 144,
      maxAgeMonths: 216,
      lowCritical: 45,
      lowNormal: 60,
      highNormal: 100,
      highCritical: 120,
      unit: 'bpm',
      source:
        'WHO Pocket Book of Hospital Care for Children 2013 & PALS Guidelines 2020',
    },

    // Respiratory Rate (WHO ETAT / IMCI 2014)
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 0,
      maxAgeMonths: 1,
      lowCritical: 25,
      lowNormal: 30,
      highNormal: 60,
      highCritical: 70,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 1,
      maxAgeMonths: 12,
      lowCritical: 20,
      lowNormal: 30,
      highNormal: 50,
      highCritical: 60,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 12,
      maxAgeMonths: 36,
      lowCritical: 16,
      lowNormal: 24,
      highNormal: 40,
      highCritical: 50,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 36,
      maxAgeMonths: 72,
      lowCritical: 14,
      lowNormal: 22,
      highNormal: 34,
      highCritical: 40,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 72,
      maxAgeMonths: 144,
      lowCritical: 12,
      lowNormal: 18,
      highNormal: 30,
      highCritical: 35,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },
    {
      vitalName: 'RESPIRATORY_RATE',
      minAgeMonths: 144,
      maxAgeMonths: 216,
      lowCritical: 10,
      lowNormal: 12,
      highNormal: 20,
      highCritical: 25,
      unit: 'breaths/min',
      source: 'WHO ETAT / IMCI Guidelines 2014',
    },

    // SpO2 (WHO Oxygen Therapy 2013)
    {
      vitalName: 'SPO2',
      minAgeMonths: 0,
      maxAgeMonths: 216,
      lowCritical: 90,
      lowNormal: 95,
      highNormal: 100,
      highCritical: null,
      unit: '%',
      source: 'WHO Pocket Book of Hospital Care for Children 2013',
    },

    // Temperature (°C, WHO IMCI 2014)
    {
      vitalName: 'TEMPERATURE',
      minAgeMonths: 0,
      maxAgeMonths: 216,
      lowCritical: 35.5,
      lowNormal: 36.5,
      highNormal: 37.5,
      highCritical: 39.5,
      unit: '°C',
      source: 'WHO IMCI Guidelines 2014',
    },

    // Systolic Blood Pressure (PALS 2020)
    {
      vitalName: 'BP_SYSTOLIC',
      minAgeMonths: 0,
      maxAgeMonths: 1,
      lowCritical: 50,
      lowNormal: 60,
      highNormal: 90,
      highCritical: 105,
      unit: 'mmHg',
      source: 'PALS Guidelines 2020',
    },
    {
      vitalName: 'BP_SYSTOLIC',
      minAgeMonths: 1,
      maxAgeMonths: 12,
      lowCritical: 60,
      lowNormal: 70,
      highNormal: 105,
      highCritical: 115,
      unit: 'mmHg',
      source: 'PALS Guidelines 2020',
    },
    {
      vitalName: 'BP_SYSTOLIC',
      minAgeMonths: 12,
      maxAgeMonths: 72,
      lowCritical: 70,
      lowNormal: 80,
      highNormal: 115,
      highCritical: 125,
      unit: 'mmHg',
      source: 'PALS Guidelines 2020',
    },
    {
      vitalName: 'BP_SYSTOLIC',
      minAgeMonths: 72,
      maxAgeMonths: 216,
      lowCritical: 80,
      lowNormal: 90,
      highNormal: 130,
      highCritical: 145,
      unit: 'mmHg',
      source: 'PALS Guidelines 2020',
    },
  ];

  for (const vr of vitalRanges) {
    const existing = await prisma.vitalRange.findFirst({
      where: {
        vitalName: vr.vitalName,
        minAgeMonths: vr.minAgeMonths,
        maxAgeMonths: vr.maxAgeMonths,
      },
    });

    if (!existing) {
      await prisma.vitalRange.create({
        data: {
          ...vr,
          status: 'PENDING_DOCTOR_APPROVAL',
        },
      });
    }
  }

  // 4. Clinical Catalog: Complaints & Signs (WHO IMCI & ETAT)
  const catalogData = [
    {
      complaint: 'Cough / Breathing Difficulty',
      description:
        'Acute respiratory tract infections, pneumonia, bronchiolitis',
      signs: [
        {
          name: 'Stridor in calm child',
          bodySystem: 'Respiratory',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'Chest indrawing',
          bodySystem: 'Respiratory',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Fast breathing',
          bodySystem: 'Respiratory',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Nasal flaring',
          bodySystem: 'Respiratory',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Wheezing',
          bodySystem: 'Respiratory',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Cough',
          bodySystem: 'Respiratory',
          redFlagLevel: 'NONE' as const,
        },
        {
          name: 'Runny nose',
          bodySystem: 'Respiratory',
          redFlagLevel: 'NONE' as const,
        },
      ],
    },
    {
      complaint: 'Fever',
      description: 'Acute febrile illness, malaria, sepsis, dengue, meningitis',
      signs: [
        {
          name: 'Convulsion / Fits',
          bodySystem: 'Neurological',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'Lethargy / Unconsciousness',
          bodySystem: 'Neurological',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'Stiff neck',
          bodySystem: 'Neurological',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'High fever > 39°C',
          bodySystem: 'General',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Persistent vomiting',
          bodySystem: 'Gastrointestinal',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Chills and rigors',
          bodySystem: 'General',
          redFlagLevel: 'NONE' as const,
        },
        {
          name: 'Body ache / Myalgia',
          bodySystem: 'General',
          redFlagLevel: 'NONE' as const,
        },
      ],
    },
    {
      complaint: 'Diarrhea / Dehydration',
      description: 'Acute gastroenteritis, cholera, dysentery, rotavirus',
      signs: [
        {
          name: 'Skin pinch goes back very slowly (> 2s)',
          bodySystem: 'Gastrointestinal',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'Unable to drink or breastfeed',
          bodySystem: 'General',
          redFlagLevel: 'EMERGENCY' as const,
        },
        {
          name: 'Sunken eyes',
          bodySystem: 'General',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Restless and irritable',
          bodySystem: 'Neurological',
          redFlagLevel: 'PRIORITY' as const,
        },
        {
          name: 'Frequent watery stools',
          bodySystem: 'Gastrointestinal',
          redFlagLevel: 'NONE' as const,
        },
        {
          name: 'Blood in stool',
          bodySystem: 'Gastrointestinal',
          redFlagLevel: 'PRIORITY' as const,
        },
      ],
    },
  ];

  for (const cat of catalogData) {
    const complaint = await prisma.complaint.upsert({
      where: { name: cat.complaint },
      update: {},
      create: {
        name: cat.complaint,
        description: cat.description,
      },
    });

    for (const signDef of cat.signs) {
      const sign = await prisma.sign.upsert({
        where: { name: signDef.name },
        update: {
          bodySystem: signDef.bodySystem,
          redFlagLevel: signDef.redFlagLevel,
        },
        create: {
          name: signDef.name,
          bodySystem: signDef.bodySystem,
          redFlagLevel: signDef.redFlagLevel,
        },
      });

      await prisma.complaintSign.upsert({
        where: {
          complaintId_signId: {
            complaintId: complaint.id,
            signId: sign.id,
          },
        },
        update: {},
        create: {
          complaintId: complaint.id,
          signId: sign.id,
        },
      });
    }
  }

  console.log('Foundation seed completed successfully!');
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
