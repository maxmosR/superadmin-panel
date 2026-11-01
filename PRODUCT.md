# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The kitchen app `order_receiver` is a native Android app built with Flutter. Treat it as Android when designing for it.)

## Users

- **Restaurant customers** order delivery or takeaway from one restaurant's own branded site, usually on a phone. They sign in with a one-time code sent to their phone and never see the BirraOra name.
- **Restaurant staff** (owners and team) run the business in the admin panel: orders, products, categories, offers, couriers, suppliers, invoices, expenses vs profit, label printing, barcode scanning and team management.
- **Kitchen staff** use a tablet running `order_receiver`. It keeps ringing for each new order until someone answers it.
- **Platform operators** (BirraOra internal) use the operator console to set up restaurants, owners, domains, feature flags and delivery zones.

## Product Purpose

BirraOra lets any Italian restaurant run its own online ordering under its own brand. One deployment serves many restaurants. Each restaurant has its own domain, products, orders, customers and couriers. Success means a restaurant can take and fulfil orders directly, without a marketplace in the middle.

## Positioning

The restaurant owns the channel. The ordering site carries its brand on its domain, its customers stay its customers, delivery is done by its own couriers, and no marketplace takes a commission per order. Just Eat, Deliveroo and Glovo can't offer this, because their model depends on owning the customer and taking a cut.

## Operating Context

- Apps:
  - `BirraOra-three-month-test`: the customer storefront.
  - `admin-panel-shop`: the restaurant admin panel.
  - `superadmin-panel`: the operator console.
  - `order_receiver`: the Android kitchen app.
- All four share one Supabase backend. Payments go through Stripe (Connect).
- The restaurant is identified by the request's domain and never chosen on screen. Staff can hold roles at several restaurants.
- Delivery fees come from zone rings and cut lines that operators draw in the console.
- Kitchen tablets run all the time with a permanent notification.

## Capabilities and Constraints

- Sign-in is passwordless only: phone first (+39 by default) or email, then a 6-digit code. No passwords and no social sign-in. Customer sign-in screens never reveal whether an account exists.
- The EU GDPR applies, including the Italian Garante's rules. Alcohol requires age 18+.
- Never show personal data in logs.
- Languages: Italian and English on every surface, the customer storefront included. Italian is the default.
- Stack: Next.js 16, React 19, Tailwind CSS 4 and shadcn/Radix on the web apps; Flutter for the kitchen app. The admin panel was first generated with v0.

## Brand Commitments

- White label: customer-facing surfaces show the restaurant's brand. The BirraOra brand never appears in front of a restaurant's customers. Sender names, templates and visible names come from each restaurant's data.
- Each restaurant brings its own branding, so the storefront design must adapt to it rather than fix one look.

## Evidence on Hand

- No testimonials, customer logos, metrics or press yet. Don't invent any.
- Product images come from each restaurant's catalogue, and some products have no photo (see `BirraOra-three-month-test/products-without-photo.txt`). Designs must handle missing images.

## Product Principles

1. The restaurant's brand comes first and BirraOra stays invisible to customers.
2. Ordering on a phone must be fast and clear: pick, pay, done.
3. Staff screens are working tools: dense, precise and quick to scan during service.
4. The kitchen must never miss an order.
5. Privacy and tenant isolation are part of the design: never show one restaurant's data, or more personal data than needed.
