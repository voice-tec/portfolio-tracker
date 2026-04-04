// api/create-checkout-session.js
import Stripe from "stripe";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = ["https://www.trackfolio.eu", "https://trackfolio.eu"];
  const allowedOrigin = allowed.includes(origin) ? origin : "*";
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const { priceId, userId, userEmail, plan } = req.body;
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
      success_url: `https://www.trackfolio.eu?pro=success`,
      cancel_url:  `https://www.trackfolio.eu?pro=cancel`,
      customer_email: userEmail || undefined,
      metadata: { userId, plan: plan || "monthly" },
      subscription_data: {
        metadata: { userId, plan: plan || "monthly" },
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    return res.status(500).json({ error: "Failed to create checkout session" });
  }
}
