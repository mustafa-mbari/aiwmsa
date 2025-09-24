// wmlab/backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seed...');

  // Create warehouses
  const warehouse1 = await prisma.warehouse.upsert({
    where: { code: 'MW001' },
    update: {},
    create: {
      name: 'Main Warehouse',
      code: 'MW001',
      location: 'Dubai, UAE',
      isActive: true,
    },
  });

  const warehouse2 = await prisma.warehouse.upsert({
    where: { code: 'DC-A' },
    update: {},
    create: {
      name: 'Distribution Center A',
      code: 'DC-A',
      location: 'Abu Dhabi, UAE',
      isActive: true,
    },
  });

  // Create departments
  const departments = [
    { name: 'Receiving', code: 'RCV' },
    { name: 'Shipping', code: 'SHP' },
    { name: 'Quality Control', code: 'QC' },
    { name: 'Inventory', code: 'INV' },
  ];

  for (const dept of departments) {
    await prisma.department.upsert({
      where: {
        code_warehouseId: {
          code: dept.code,
          warehouseId: warehouse1.id,
        },
      },
      update: {},
      create: {
        name: dept.name,
        code: dept.code,
        warehouseId: warehouse1.id,
        isActive: true,
      },
    });
  }

  // Create users
  const hashedPassword = await bcrypt.hash('password123', 10);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@wmlab.com' },
    update: {},
    create: {
      email: 'admin@wmlab.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'Admin',
      isActive: true,
      warehouseId: warehouse1.id,
    },
  });

  const expertUser = await prisma.user.upsert({
    where: { email: 'expert@wmlab.com' },
    update: {},
    create: {
      email: 'expert@wmlab.com',
      password: hashedPassword,
      name: 'Expert User',
      role: 'Expert',
      isActive: true,
      warehouseId: warehouse1.id,
    },
  });

  const workerUser = await prisma.user.upsert({
    where: { email: 'worker@wmlab.com' },
    update: {},
    create: {
      email: 'worker@wmlab.com',
      password: hashedPassword,
      name: 'Worker User',
      role: 'Worker',
      isActive: true,
      warehouseId: warehouse1.id,
    },
  });

  // Create sample equipment
  const forklift = await prisma.equipment.create({
    data: {
      name: 'Electric Forklift A-01',
      code: 'FL-001',
      type: 'Forklift',
      manufacturer: 'Toyota',
      model: 'Model 8FBE',
      serialNumber: 'SN-2024-001',
      warehouseId: warehouse1.id,
      status: 'operational',
    },
  });

  // Create error codes for equipment
  const errorCodes = [
    {
      code: 'E001',
      description: 'Battery low - less than 20% charge remaining',
      solution: '1. Park the forklift in charging station\n2. Connect charging cable\n3. Wait for full charge (typically 6-8 hours)',
      severity: 'medium',
      category: 'Battery',
    },
    {
      code: 'E002',
      description: 'Hydraulic fluid level low',
      solution: '1. Check for leaks\n2. Add hydraulic fluid to recommended level\n3. If leak found, contact maintenance',
      severity: 'high',
      category: 'Hydraulics',
    },
    {
      code: 'E003',
      description: 'Emergency stop activated',
      solution: '1. Check surroundings for safety\n2. Reset emergency stop button by twisting clockwise\n3. Restart equipment',
      severity: 'low',
      category: 'Safety',
    },
  ];

  for (const errorCode of errorCodes) {
    await prisma.errorCode.create({
      data: {
        ...errorCode,
        equipmentId: forklift.id,
      },
    });
  }

  // Create sample documents
  const sampleDocs = [
    {
      title: 'Forklift Safety Manual',
      description: 'Comprehensive safety guidelines for operating forklifts',
      category: 'Safety',
      filename: 'forklift-safety.pdf',
      originalName: 'Forklift_Safety_Manual_2024.pdf',
      mimeType: 'application/pdf',
      size: BigInt(2548576), // ~2.5MB
      path: '/uploads/documents/forklift-safety.pdf',
      language: 'en',
      isPublic: true,
      uploadedById: expertUser.id,
      warehouseId: warehouse1.id,
      status: 'completed',
      extractedText: 'This manual provides comprehensive safety guidelines...',
    },
    {
      title: 'Warehouse SOPs',
      description: 'Standard Operating Procedures for warehouse operations',
      category: 'SOPs',
      filename: 'warehouse-sops.pdf',
      originalName: 'Warehouse_SOPs_v2.pdf',
      mimeType: 'application/pdf',
      size: BigInt(3145728), // ~3MB
      path: '/uploads/documents/warehouse-sops.pdf',
      language: 'en',
      isPublic: true,
      uploadedById: adminUser.id,
      warehouseId: warehouse1.id,
      status: 'completed',
      extractedText: 'Standard Operating Procedures for daily warehouse operations...',
    },
  ];

  for (const doc of sampleDocs) {
    const document = await prisma.document.create({
      data: doc,
    });

    // Create sample chunks for the document
    const chunks = [
      {
        content: 'Chapter 1: Introduction to Forklift Safety. Safety is paramount when operating heavy machinery...',
        chunkIndex: 0,
        tokenCount: 150,
        metadata: { page: 1, section: 'Introduction', type: 'text' },
      },
      {
        content: 'Chapter 2: Pre-Operation Inspection. Before operating a forklift, conduct a thorough inspection...',
        chunkIndex: 1,
        tokenCount: 175,
        metadata: { page: 5, section: 'Inspection', type: 'text' },
      },
    ];

    for (const chunk of chunks) {
      await prisma.chunk.create({
        data: {
          ...chunk,
          documentId: document.id,
        },
      });
    }
  }

  console.log('Database seed completed successfully!');
  console.log('\nTest accounts created:');
  console.log('Admin: admin@wmlab.com / password123');
  console.log('Expert: expert@wmlab.com / password123');
  console.log('Worker: worker@wmlab.com / password123');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// wmlab/backend/prisma/init.sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create custom functions if needed
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops);

-- wmlab/backend/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "logs", "uploads"]
  }