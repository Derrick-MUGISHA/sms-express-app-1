require('dotenv').config();
const { PrismaClient } = require('../src/generated/prisma');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

async function main() {
  const adminEmail = 'admin@example.com';
  const adminPassword = 'adminpassword123';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
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
    console.log(`ℹ️ Supervisor account already exists: ${existingAdmin.email}`);
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
