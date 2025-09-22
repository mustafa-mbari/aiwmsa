// ============= backend/prisma/init.sql =============
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON queries(created_at DESC);

-- Create function for updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============= backend/prisma/seeds/seed.ts =============
import { PrismaClient, UserRole, Language } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create warehouses
  const warehouse1 = await prisma.warehouse.upsert({
    where: { code: 'WH001' },
    update: {},
    create: {
      code: 'WH001',
      name: 'Main Warehouse',
      location: 'Dubai, UAE',
      description: 'Primary distribution center',
    },
  });

  const warehouse2 = await prisma.warehouse.upsert({
    where: { code: 'WH002' },
    update: {},
    create: {
      code: 'WH002',
      name: 'Secondary Warehouse',
      location: 'Abu Dhabi, UAE',
      description: 'Secondary storage facility',
    },
  });

  console.log('✅ Warehouses created');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@wmlab.com' },
    update: {},
    create: {
      email: 'admin@wmlab.com',
      username: 'admin',
      password: adminPassword,
      role: UserRole.ADMIN,
      firstName: 'System',
      lastName: 'Administrator',
      preferredLanguage: Language.EN,
      department: 'IT',
      warehouseId: warehouse1.id,
    },
  });

  console.log('✅ Admin user created');

  // Create expert users
  const expertPassword = await bcrypt.hash('Expert@123', 10);
  
  const expert1 = await prisma.user.upsert({
    where: { email: 'expert1@wmlab.com' },
    update: {},
    create: {
      email: 'expert1@wmlab.com',
      username: 'expert1',
      password: expertPassword,
      role: UserRole.EXPERT,
      firstName: 'John',
      lastName: 'Expert',
      preferredLanguage: Language.EN,
      department: 'Operations',
      warehouseId: warehouse1.id,
    },
  });

  const expert2 = await prisma.user.upsert({
    where: { email: 'expert2@wmlab.com' },
    update: {},
    create: {
      email: 'expert2@wmlab.com',
      username: 'expert2',
      password: expertPassword,
      role: UserRole.EXPERT,
      firstName: 'Sarah',
      lastName: 'Knowledge',
      preferredLanguage: Language.EN,
      department: 'Quality',
      warehouseId: warehouse2.id,
    },
  });

  console.log('✅ Expert users created');

  // Create worker users
  const workerPassword = await bcrypt.hash('Worker@123', 10);
  
  const worker1 = await prisma.user.upsert({
    where: { email: 'worker1@wmlab.com' },
    update: {},
    create: {
      email: 'worker1@wmlab.com',
      username: 'worker1',
      password: workerPassword,
      role: UserRole.WORKER,
      firstName: 'Ahmed',
      lastName: 'Ali',
      preferredLanguage: Language.AR,
      department: 'Picking',
      warehouseId: warehouse1.id,
    },
  });

  const worker2 = await prisma.user.upsert({
    where: { email: 'worker2@wmlab.com' },
    update: {},
    create: {
      email: 'worker2@wmlab.com',
      username: 'worker2',
      password: workerPassword,
      role: UserRole.WORKER,
      firstName: 'Maria',
      lastName: 'Garcia',
      preferredLanguage: Language.EN,
      department: 'Packing',
      warehouseId: warehouse1.id,
    },
  });

  const worker3 = await prisma.user.upsert({
    where: { email: 'worker3@wmlab.com' },
    update: {},
    create: {
      email: 'worker3@wmlab.com',
      username: 'worker3',
      password: workerPassword,
      role: UserRole.WORKER,
      firstName: 'Klaus',
      lastName: 'Mueller',
      preferredLanguage: Language.DE,
      department: 'Shipping',
      warehouseId: warehouse2.id,
    },
  });

  console.log('✅ Worker users created');

  // Create some tags
  const tags = [
    { name: 'safety', category: 'compliance' },
    { name: 'forklift', category: 'equipment' },
    { name: 'picking', category: 'process' },
    { name: 'packing', category: 'process' },
    { name: 'shipping', category: 'process' },
    { name: 'emergency', category: 'priority' },
    { name: 'training', category: 'education' },
  ];

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      update: {},
      create: tag,
    });
  }

  console.log('✅ Tags created');

  console.log('🎉 Database seeding completed successfully!');
  console.log('\n📋 Test Credentials:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Admin:   admin@wmlab.com / Admin@123');
  console.log('Expert:  expert1@wmlab.com / Expert@123');
  console.log('Worker:  worker1@wmlab.com / Worker@123');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });