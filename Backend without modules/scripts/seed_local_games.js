const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const now = Date.now();
    const samples = [
      {
        league: "NBA",
        homeTeam: "Lakers",
        awayTeam: "Warriors",
        startTime: new Date(now + 1000 * 60 * 60 * 4),
      },
      {
        league: "NBA",
        homeTeam: "Celtics",
        awayTeam: "Bucks",
        startTime: new Date(now + 1000 * 60 * 60 * 9),
      },
      {
        league: "NHL",
        homeTeam: "Maple Leafs",
        awayTeam: "Canadiens",
        startTime: new Date(now + 1000 * 60 * 60 * 3),
      },
    ];
    for (const s of samples) {
      await prisma.game.create({ data: s });
    }
    console.log("Seed complete");
  } catch (e) {
    console.error("seed err", e.message || e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
