// src/routes/admin.orders.ts
import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

/**
 * GET /api/admin/orders?month=&year=&q=
 * - month/year: filtran por fecha (según zona horaria local)
 * - q:
 *    · vacío   => solo por mes/año
 *    · número  => busca por id de pedido (1 o #1)
 *    · texto   => busca por nombre de cliente (contiene)
 */
router.get("/api/admin/orders", async (req, res) => {
  try {
    const now = new Date();
    const month = req.query.month ? Number(req.query.month) : now.getMonth() + 1;
    const year  = req.query.year  ? Number(req.query.year)  : now.getFullYear();
    const rawQ  = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const tz = "America/Bogota";

    const conditions: string[] = [];

    if (rawQ) {
      // Si q se ve como un número (#12 o 12) buscamos por id de pedido
      const numText = rawQ.replace(/^#/, "");
      const idSearch = Number(numText);
      if (!Number.isNaN(idSearch) && Number.isFinite(idSearch)) {
        conditions.push(`o.id = ${idSearch}`);
      } else {
        // Búsqueda por nombre de cliente (case insensitive)
        const safe = rawQ.replace(/'/g, "''");
        conditions.push(`LOWER(o.customer_name) LIKE LOWER('%${safe}%')`);
      }
    } else {
      // Filtro por mes/año en zona "America/Bogota" para que coincida con lo que ve el usuario
      if (month) {
        conditions.push(
          `EXTRACT(MONTH FROM (o.date AT TIME ZONE '${tz}')) = ${month}`
        );
      }
      if (year) {
        conditions.push(
          `EXTRACT(YEAR FROM (o.date AT TIME ZONE '${tz}')) = ${year}`
        );
      }
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT
        o.id,
        o.date,
        o.customer_name,
        o.customer_phone,
        o.total_cents AS total,
        COUNT(oi.id)::int AS items_count
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ${whereSql}
      GROUP BY o.id
      ORDER BY (o.date AT TIME ZONE '${tz}') DESC
    `;

    const items = await prisma.$queryRawUnsafe<any[]>(sql);

    return res.json({ items });
  } catch (e: any) {
    console.error("ERROR /api/admin/orders", e);
    return res.status(500).json({ error: "Error al obtener pedidos" });
  }
});

/**
 * POST /api/admin/orders
 * Body:
 * {
 *   date: string ISO,
 *   customer: { full_name?: string | null, phone?: string | null },
 *   items: Array<{ product_id: number | null, name: string, qty: number, unit_price: number }>
 * }
 */
router.post("/api/admin/orders", async (req, res) => {
  const { date, customer, items } = req.body || {};
  const customer_name  = customer?.full_name || null;
  const customer_phone = customer?.phone || null;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items es requerido" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Normalizo fecha: si viene algo raro, uso ahora
      let orderDate: Date;
      try {
        orderDate = date ? new Date(date) : new Date();
        if (isNaN(orderDate.getTime())) {
          orderDate = new Date();
        }
      } catch {
        orderDate = new Date();
      }

      // Calculo total en centavos con base en los ítems
      let totalCents = 0;
      const normalizedItems = items.map((it: any) => {
        const qty = Number(it.qty) || 0;
        const unitPrice = Number(it.unit_price) || 0;
        // Tu front ya manda el precio en pesos enteros,
        // así que aquí lo dejamos tal cual como "centavos"
        const cents = Math.round(unitPrice);
        totalCents += qty * cents;
        return {
          product_id: it.product_id ?? null,
          name: String(it.name || "").trim() || "(Sin nombre)",
          qty,
          unit_price_cents: cents,
        };
      });

      // 1) Crear pedido
      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO orders (date, customer_name, customer_phone, total_cents)
        VALUES (${orderDate.toISOString()}, ${customer_name}, ${customer_phone}, ${totalCents})
        RETURNING id;
      `;

      const orderId = inserted[0]?.id;
      if (!orderId) throw new Error("No se pudo crear el pedido");

      // 2) Insertar ítems
      for (const it of normalizedItems) {
        await tx.$executeRaw`
          INSERT INTO order_items (order_id, product_id, name, qty, unit_price_cents)
          VALUES (${orderId}, ${it.product_id}, ${it.name}, ${it.qty}, ${it.unit_price_cents});
        `;
      }

      return { id: orderId };
    });

    return res.status(201).json(result);
  } catch (e: any) {
    console.error("ERROR creando pedido", e);
    return res
      .status(409)
      .json({ error: e?.message || "No se pudo crear el pedido" });
  }
});

export default router;
