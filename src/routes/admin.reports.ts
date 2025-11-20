// src/routes/admin.reports.ts
import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

/**
 * Ventas por día del mes
 * GET /api/admin/reports/sales?month=&year=
 */
router.get("/api/admin/reports/sales", async (req, res) => {
  try {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year  = Number(req.query.year)  || now.getFullYear();

    const rows = await prisma.$queryRaw<
      { day: number; total: number }[]
    >`
      SELECT
        EXTRACT(DAY FROM o.date)::int                       AS day,
        COALESCE(SUM(oi.qty * oi.unit_price_cents), 0)::int AS total
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE EXTRACT(MONTH FROM o.date) = ${month}
        AND EXTRACT(YEAR  FROM o.date) = ${year}
      GROUP BY day
      ORDER BY day ASC;
    `;

    const labels = rows.map((r) => String(r.day).padStart(2, "0"));
    const values = rows.map((r) => r.total);

    res.json({ labels, values });
  } catch (err) {
    console.error("ERROR /api/admin/reports/sales", err);
    res.status(500).json({ error: "Error al cargar ventas" });
  }
});

/**
 * Top productos
 * GET /api/admin/reports/top-products?month=&year=
 */
router.get("/api/admin/reports/top-products", async (req, res) => {
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;

    type Row = { name: string; qty: number };
    let rows: Row[] = [];

    if (month && year) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          COALESCE(oi.name, '(Sin nombre)') AS name,
          COALESCE(SUM(oi.qty),0)::int      AS qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE EXTRACT(YEAR  FROM o.date) = ${year}
          AND EXTRACT(MONTH FROM o.date) = ${month}
        GROUP BY name
        ORDER BY qty DESC
        LIMIT 10;
      `;
    } else if (year) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          COALESCE(oi.name, '(Sin nombre)') AS name,
          COALESCE(SUM(oi.qty),0)::int      AS qty
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE EXTRACT(YEAR FROM o.date) = ${year}
        GROUP BY name
        ORDER BY qty DESC
        LIMIT 10;
      `;
    } else {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          COALESCE(oi.name, '(Sin nombre)') AS name,
          COALESCE(SUM(oi.qty),0)::int      AS qty
        FROM order_items oi
        GROUP BY name
        ORDER BY qty DESC
        LIMIT 10;
      `;
    }

    const labels = rows.map((r) => r.name);
    const values = rows.map((r) => r.qty);

    res.json({ labels, values });
  } catch (err) {
    console.error("ERROR /api/admin/reports/top-products", err);
    res.status(500).json({ error: "Error al cargar top productos" });
  }
});

export default router;
