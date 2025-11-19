// src/routes/admin.orders.ts
import { Router } from "express";
import { prisma } from "../prisma";

const router = Router();

/**
 * GET /api/admin/orders?month=&year=&q=
 * - month/year: filtran por fecha
 * - q:
 *    · vacío   => solo por mes/año
 *    · número  => busca por id de pedido (1 o #1)
 *    · texto   => busca por nombre de cliente
 */
router.get("/api/admin/orders", async (req, res) => {
  try {
    const now = new Date();
    const month = Number(req.query.month) || now.getMonth() + 1;
    const year  = Number(req.query.year)  || now.getFullYear();

    const rawQ = (req.query.q as string | undefined)?.trim() || "";
    const term = rawQ.startsWith("#") ? rawQ.slice(1).trim() : rawQ;
    const isNumeric = /^\d+$/.test(term);
    const orderId   = isNumeric ? Number(term) : null;

    type Row = {
      id: number;
      date: Date;
      customer_name: string | null;
      items_count: number;
      total: number;
    };

    let rows: Row[] = [];

    // ------- sin búsqueda: solo mes/año -------
    if (!term) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          o.id,
          o.date,
          o.customer_name,
          COALESCE(SUM(oi.qty),0)::int                       AS items_count,
          COALESCE(SUM(oi.qty * oi.unit_price_cents),0)::int AS total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE EXTRACT(MONTH FROM o.date) = ${month}
          AND EXTRACT(YEAR  FROM o.date) = ${year}
        GROUP BY o.id
        ORDER BY o.date ASC, o.id ASC;
      `;
    }

    // ------- búsqueda por número de pedido -------
    else if (orderId !== null) {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          o.id,
          o.date,
          o.customer_name,
          COALESCE(SUM(oi.qty),0)::int                       AS items_count,
          COALESCE(SUM(oi.qty * oi.unit_price_cents),0)::int AS total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE EXTRACT(MONTH FROM o.date) = ${month}
          AND EXTRACT(YEAR  FROM o.date) = ${year}
          AND o.id = ${orderId}
        GROUP BY o.id
        ORDER BY o.date ASC, o.id ASC;
      `;
    }

    // ------- búsqueda por nombre de cliente -------
    else {
      rows = await prisma.$queryRaw<Row[]>`
        SELECT
          o.id,
          o.date,
          o.customer_name,
          COALESCE(SUM(oi.qty),0)::int                       AS items_count,
          COALESCE(SUM(oi.qty * oi.unit_price_cents),0)::int AS total
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE EXTRACT(MONTH FROM o.date) = ${month}
          AND EXTRACT(YEAR  FROM o.date) = ${year}
          AND LOWER(COALESCE(o.customer_name,'')) LIKE '%' || LOWER(${term}) || '%'
        GROUP BY o.id
        ORDER BY o.date ASC, o.id ASC;
      `;
    }

    return res.json({ items: rows || [] });
  } catch (err) {
    console.error("ERROR /api/admin/orders", err);
    return res.status(500).json({ error: "Error al cargar pedidos" });
  }
});

/**
 * POST /api/admin/orders
 * Body esperado (lo que mandaremos desde orders.js):
 * {
 *   date: string ISO,
 *   customer: { full_name?: string|null, phone?: string|null },
 *   items: [
 *     { product_id?: number|null, name?: string, qty: number, unit_price?: number }
 *   ]
 * }
 *
 * - Inserta en orders y order_items
 * - Descuenta stock de products cuando viene product_id
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
      // 1) Crear pedido
      const inserted = await tx.$queryRaw<{ id: number }[]>`
        INSERT INTO orders (date, customer_name, customer_phone)
        VALUES (${date ? new Date(date) : new Date()}, ${customer_name}, ${customer_phone})
        RETURNING id;
      `;
      const orderId = inserted[0].id;
      let total = 0;

      // 2) Procesar items
      for (const raw of items as any[]) {
        const qty  = Math.max(1, Number(raw.qty || 1));
        let unit   = Math.max(0, Number(raw.unit_price_cents ?? raw.unit_price ?? 0));
        let name   = String(raw.name || "").trim() || null;
        const pid  = raw.product_id ? BigInt(raw.product_id) : null;

        if (pid) {
          // Bloqueo el producto para evitar carreras
          const prod = await tx.$queryRaw<{
            id: bigint;
            name: string;
            price_cents: number;
            stock: number;
          }[]>`
            SELECT id, name, price_cents, stock
            FROM products
            WHERE id = ${pid} FOR UPDATE;
          `;

          if (prod.length === 0) {
            throw new Error(`Producto ${pid.toString()} no existe`);
          }
          if (prod[0].stock < qty) {
            throw new Error(
              `Stock insuficiente de "${prod[0].name}". Disponible: ${prod[0].stock}, solicitado: ${qty}`
            );
          }

          if (!unit) unit = Math.max(0, Number(prod[0].price_cents || 0));
          if (!name) name = prod[0].name;

          // Descuento stock
          await tx.$executeRaw`
            UPDATE products
            SET stock = stock - ${qty}
            WHERE id = ${pid};
          `;
        } else {
          // Ítem manual: al menos debe tener nombre
          if (!name) throw new Error("El ítem sin producto necesita 'name'");
        }

        total += unit * qty;

        await tx.$executeRaw`
          INSERT INTO order_items (order_id, product_id, name, qty, unit_price_cents)
          VALUES (${orderId}, ${pid}, ${name}, ${qty}, ${unit});
        `;
      }

      // 3) Actualizo total de la orden
      await tx.$executeRaw`
        UPDATE orders
        SET total_cents = ${total}
        WHERE id = ${orderId};
      `;

      return { id: orderId };
    });

    return res.status(201).json(result);
  } catch (e: any) {
    console.error("ERROR creando pedido", e);
    return res.status(409).json({ error: e?.message || "No se pudo crear el pedido" });
  }
});

export default router;
