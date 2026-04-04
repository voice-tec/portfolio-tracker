// api/stripe.js — Gestisce checkout Stripe e webhook in un unico endpoint
import Stripe from "stripe";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://www.trackfolio.eu", "https://trackfolio.eu"];
  const allowedOrigin = allowed.includes(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, stripe-signature");
}

async function updateUserPro(userId, isPro, planEnd) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({
      is_pro: isPro,
      pro_plan_end: planEnd || null,
      updated_at: new Date().toISOString(),
    }),
  });
  return res.ok;
}

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const isWebhook = !!req.headers["stripe-signature"];

  // Leggi body una sola volta
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks);

  // ── WEBHOOK ────────────────────────────────────────────────────────────────
  if (isWebhook) {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }
    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const userId = session.metadata?.userId;
          if (userId) await updateUserPro(userId, true, null);
          break;
        }
        case "customer.subscription.deleted":
        case "customer.subscription.paused": {
          const sub = event.data.object;
          const userId = sub.metadata?.userId;
          if (userId) await updateUserPro(userId, false, null);
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object;
          const userId = sub.metadata?.userId;
          if (userId) {
            const isPro = sub.status === "active" || sub.status === "trialing";
            const planEnd = sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null;
            await updateUserPro(userId, isPro, planEnd);
          }
          break;
        }
      }
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("Webhook handler error:", err.message);
      return res.status(500).json({ error: "Webhook handler failed" });
    }
  }

  // ── CHECKOUT SESSION ───────────────────────────────────────────────────────
  console.log("[stripe] rawBody length:", rawBody.length, "content:", rawBody.toString().slice(0,200));
  let body = {};
  try {
    body = JSON.parse(rawBody.toString());
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  const { priceId, userId, userEmail, plan } = body;

  if (!priceId || !userId) return res.status(400).json({ error: "Missing priceId or userId" });

  const validPrices = [
    process.env.STRIPE_PRICE_MONTHLY,
    process.env.STRIPE_PRICE_YEARLY,
  ];
  if (!validPrices.includes(priceId)) {
    return res.status(400).json({ error: "Invalid price ID" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://www.trackfolio.eu?pro=success",
      cancel_url:  "https://www.trackfolio.eu?pro=cancel",
      customer_email: userEmail || undefined,
      metadata: { userId, plan: plan || "monthly" },
      subscription_data: { metadata: { userId, plan: plan || "monthly" } },
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}
