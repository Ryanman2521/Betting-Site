// Local helper to run the mock odds updater without requiring HTTP/admin headers.
const { PrismaClient } = require("@prisma/client");
const odds = require("../services/oddsService");

async function main() {
  const prisma = new PrismaClient();
  try {
    const updated = await odds.fetchAndUpdateOdds(prisma);
    console.log("Mock odds updated:", updated);
  } catch (e) {
    console.error("Error running mock odds:", e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
