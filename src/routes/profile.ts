import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// GET /api/me -> datos de perfil
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const id = req.user!.id;
    const rows = await prisma.$queryRaw<{
      id: number; email: string; username: string | null;
      full_name: string | null; phone: string | null;
      address_line1: string | null; address_line2: string | null;
      city: string | null; state: string | null; postal_code: string | null;
      country: string | null; 
    }[]>(Prisma.sql`
      SELECT
        id::int, email, username,
        full_name, phone, address_line1, address_line2,
        city, state, postal_code, country
      FROM users WHERE id = ${id}
    `);
    res.json(rows[0] || {});
  } catch (e) { next(e); }
});

// PUT /api/me -> actualiza perfil (campos permitidos)
router.put("/", requireAuth, async (req, res, next) => {
  try {
    const id = req.user!.id;
    const b = (req.body || {}) as any;

    const sets: Prisma.Sql[] = [];
    const allow = [
      "full_name","phone","address_line1","address_line2",
      "city","state","postal_code","country"
    ];
    for (const k of allow) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        const v = (b[k] ?? null) as string | null;
        // recorte y normalización simple
        const val = v === null ? null : String(v).trim().slice(0, 120);
        sets.push(Prisma.sql`${Prisma.raw(k)} = ${val}`);
      }
    }
    if (sets.length) {
      let setSql = sets[0];
      for (let i = 1; i < sets.length; i++) setSql = Prisma.sql`${setSql}, ${sets[i]}`;
      await prisma.$executeRaw(Prisma.sql`UPDATE users SET ${setSql}, updated_at = now() WHERE id = ${id}`);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/me/ready -> valida perfil completo para checkout
router.get("/ready", requireAuth, async (req, res, next) => {
  try {
    const id = req.user!.id;
    const [u] = await prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT full_name, phone, address_line1, city, country,
      FROM users WHERE id = ${id}
    `);
    const missing: string[] = [];
    if (!u?.full_name)     missing.push("Nombre completo");
    if (!u?.phone)         missing.push("Teléfono");
    if (!u?.address_line1) missing.push("Dirección");
    if (!u?.city)          missing.push("Ciudad");
    if (!u?.country)       missing.push("País");

    res.json({ ok: missing.length === 0, missing });
  } catch (e) { next(e); }
});

export default router;
