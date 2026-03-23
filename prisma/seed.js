require('dotenv').config();
const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  const adminEmail = process.env.SUPERVISOR_EMAIL || 'admin@example.com';
  const adminPassword = process.env.SUPERVISOR_PASSWORD || 'adminpassword123';

  const existingSupervisor = await prisma.user.findFirst({
    where: { role: 'SUPERVISOR' }
  });

  if (!existingSupervisor) {
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: 'SUPERVISOR',
        isVerified: true
      }
    });
    console.log(`✅ Supervisor account created:
      Email: ${admin.email}
      Password: ${adminPassword}`);
  } else {
    console.log(`ℹ️ Supervisor account already exists: ${existingSupervisor.email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
