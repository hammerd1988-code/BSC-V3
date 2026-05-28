import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// ---------------------------------------------------------------------------
// Plan configuration — single source of truth for tier → Stripe price mapping
// ---------------------------------------------------------------------------

export type PlanTier = 'indie' | 'operator' | 'architect';

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  stripePriceIdMonthly: string;
  stripePriceIdAnnual: string;
}

export const PLAN_CONFIG: Record<Exclude<PlanTier, 'indie'>, PlanConfig> = {
  operator: {
    tier: 'operator',
    name: 'Operator',
    monthlyPriceCents: 1500,
    annualPriceCents: 1200,
    stripePriceIdMonthly: process.env.STRIPE_OPERATOR_MONTHLY_PRICE_ID || '',
    stripePriceIdAnnual: process.env.STRIPE_OPERATOR_ANNUAL_PRICE_ID || '',
  },
  architect: {
    tier: 'architect',
    name: 'Architect',
    monthlyPriceCents: 3900,
    annualPriceCents: 2900,
    stripePriceIdMonthly: process.env.STRIPE_ARCHITECT_MONTHLY_PRICE_ID || '',
    stripePriceIdAnnual: process.env.STRIPE_ARCHITECT_ANNUAL_PRICE_ID || '',
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-04-30.basil' as any });
}

function getWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET || '';
}

async function resolveUserByAuthUid(
  supabase: SupabaseClient,
  authUid: string,
): Promise<{ id: string; email: string | null } | null> {
  const { data } = await supabase
    .from('users')
    .select('id, email')
    .eq('auth_uid', authUid)
    .limit(1)
    .maybeSingle();
  return data;
}

async function resolveUserByStripeCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .limit(1)
    .maybeSingle();
  return data ? { id: data.user_id } : null;
}

function tierFromPriceId(priceId: string): PlanTier {
  for (const plan of Object.values(PLAN_CONFIG)) {
    if (priceId === plan.stripePriceIdMonthly || priceId === plan.stripePriceIdAnnual) {
      return plan.tier;
    }
  }
  return 'indie';
}

// ---------------------------------------------------------------------------
// Authenticate request via Supabase JWT
// ---------------------------------------------------------------------------

async function authenticateRequest(
  req: Request,
  supabase: SupabaseClient,
): Promise<{ id: string; email: string | null } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  return resolveUserByAuthUid(supabase, user.id);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerStripeRoutes(app: Express, supabase: SupabaseClient): void {
  const stripe = getStripe();

  // ── GET /api/stripe/plans ──
  // Public endpoint returning available plans + prices
  app.get('/api/stripe/plans', (_req: Request, res: Response) => {
    res.json({
      plans: [
        { tier: 'indie', name: 'Indie', monthlyPrice: 0, annualPrice: 0 },
        {
          tier: 'operator',
          name: 'Operator',
          monthlyPrice: PLAN_CONFIG.operator.monthlyPriceCents,
          annualPrice: PLAN_CONFIG.operator.annualPriceCents,
        },
        {
          tier: 'architect',
          name: 'Architect',
          monthlyPrice: PLAN_CONFIG.architect.monthlyPriceCents,
          annualPrice: PLAN_CONFIG.architect.annualPriceCents,
        },
      ],
    });
  });

  // ── POST /api/stripe/checkout ──
  // Creates a Stripe Checkout session for upgrading to a paid plan
  app.post('/api/stripe/checkout', async (req: Request, res: Response) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { tier, billing } = req.body as { tier: PlanTier; billing: 'monthly' | 'annual' };
    const plan = PLAN_CONFIG[tier as keyof typeof PLAN_CONFIG];
    if (!plan) return res.status(400).json({ error: 'Invalid plan tier.' });

    const priceId = billing === 'annual' ? plan.stripePriceIdAnnual : plan.stripePriceIdMonthly;
    if (!priceId) return res.status(400).json({ error: 'Price not configured for this billing cycle.' });

    try {
      // Find or create Stripe customer
      let customerId: string | undefined;
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .not('stripe_customer_id', 'is', null)
        .limit(1)
        .maybeSingle();

      if (existingSub?.stripe_customer_id) {
        customerId = existingSub.stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { bsc_user_id: user.id },
        });
        customerId = customer.id;
      }

      const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:3001';

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${appUrl}/settings?subscription=success`,
        cancel_url: `${appUrl}/settings?subscription=cancelled`,
        metadata: { bsc_user_id: user.id, tier: plan.tier },
        subscription_data: {
          metadata: { bsc_user_id: user.id, tier: plan.tier },
        },
      });

      res.json({ url: session.url });
    } catch (err: any) {
      console.error('[Stripe] Checkout error:', err.message);
      res.status(500).json({ error: 'Failed to create checkout session.' });
    }
  });

  // ── POST /api/stripe/portal ──
  // Creates a Stripe Customer Portal session for billing management
  app.post('/api/stripe/portal', async (req: Request, res: Response) => {
    if (!stripe) return res.status(503).json({ error: 'Stripe is not configured.' });

    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .not('stripe_customer_id', 'is', null)
        .limit(1)
        .maybeSingle();

      if (!sub?.stripe_customer_id) {
        return res.status(404).json({ error: 'No active subscription found.' });
      }

      const appUrl = process.env.APP_URL || process.env.VITE_APP_URL || 'http://localhost:3001';

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${appUrl}/settings`,
      });

      res.json({ url: portalSession.url });
    } catch (err: any) {
      console.error('[Stripe] Portal error:', err.message);
      res.status(500).json({ error: 'Failed to create portal session.' });
    }
  });

  // ── POST /api/stripe/webhook ──
  // Stripe webhook endpoint — MUST use raw body for signature verification
  // Note: express.raw() middleware is applied specifically to this route
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
      if (!stripe) return res.status(503).send('Stripe not configured');

      const sig = req.headers['stripe-signature'] as string;
      const webhookSecret = getWebhookSecret();

      if (!webhookSecret) {
        console.warn('[Stripe Webhook] STRIPE_WEBHOOK_SECRET not set, skipping verification');
        return res.status(400).send('Webhook secret not configured');
      }

      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err: any) {
        console.error('[Stripe Webhook] Signature verification failed:', err.message);
        return res.status(400).send(`Webhook signature invalid: ${err.message}`);
      }

      try {
        await handleStripeEvent(event, supabase, stripe);
        res.json({ received: true });
      } catch (err: any) {
        console.error('[Stripe Webhook] Handler error:', err.message);
        res.status(500).send('Webhook handler error');
      }
    },
  );

  // ── GET /api/stripe/subscription ──
  // Returns current user's subscription status
  app.get('/api/stripe/subscription', async (req: Request, res: Response) => {
    const user = await authenticateRequest(req, supabase);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({ subscription: sub, tier: sub?.tier || 'indie' });
  });
}

// We need express for express.raw — import it at module level
import express from 'express';

// ---------------------------------------------------------------------------
// Stripe event handler
// ---------------------------------------------------------------------------

async function handleStripeEvent(
  event: Stripe.Event,
  supabase: SupabaseClient,
  stripe: Stripe,
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== 'subscription') break;

      const userId = session.metadata?.bsc_user_id;
      const tier = session.metadata?.tier as PlanTier | undefined;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;

      if (!userId || !tier) {
        console.warn('[Stripe Webhook] checkout.session.completed missing metadata');
        break;
      }

      // Upsert subscription record
      await supabase.from('subscriptions').upsert(
        {
          user_id: userId,
          tier,
          status: 'active',
          started_at: new Date().toISOString(),
          expires_at: null,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
        },
        { onConflict: 'user_id' },
      );

      // Sync user tier
      await supabase
        .from('users')
        .update({ subscription_tier: tier, updated_at: new Date().toISOString() })
        .eq('id', userId);

      console.log(`[Stripe] User ${userId} upgraded to ${tier}`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      const status = subscription.status;
      const priceId = subscription.items.data[0]?.price?.id || '';
      const tier = tierFromPriceId(priceId);

      const user = await resolveUserByStripeCustomer(supabase, customerId);
      if (!user) break;

      const mappedStatus = status === 'active' || status === 'trialing'
        ? 'active'
        : status === 'past_due'
          ? 'past_due'
          : 'cancelled';

      await supabase
        .from('subscriptions')
        .update({
          tier: mappedStatus === 'cancelled' ? 'indie' : tier,
          status: mappedStatus,
          stripe_subscription_id: subscription.id,
          expires_at: subscription.items.data[0]?.current_period_end
            ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
            : null,
        })
        .eq('user_id', user.id)
        .eq('stripe_customer_id', customerId);

      // Sync user tier
      await supabase
        .from('users')
        .update({
          subscription_tier: mappedStatus === 'cancelled' ? 'indie' : tier,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      console.log(`[Stripe] Subscription updated for user ${user.id}: ${tier} (${mappedStatus})`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;

      const user = await resolveUserByStripeCustomer(supabase, customerId);
      if (!user) break;

      await supabase
        .from('subscriptions')
        .update({ tier: 'indie', status: 'cancelled' })
        .eq('user_id', user.id)
        .eq('stripe_customer_id', customerId);

      await supabase
        .from('users')
        .update({ subscription_tier: 'indie', updated_at: new Date().toISOString() })
        .eq('id', user.id);

      console.log(`[Stripe] Subscription cancelled for user ${user.id}`);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      const user = await resolveUserByStripeCustomer(supabase, customerId);
      if (!user) break;

      await supabase
        .from('subscriptions')
        .update({ status: 'past_due' })
        .eq('user_id', user.id)
        .eq('stripe_customer_id', customerId);

      console.log(`[Stripe] Payment failed for user ${user.id}`);
      break;
    }

    default:
      break;
  }
}
