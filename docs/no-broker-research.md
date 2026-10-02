# "No-broker" flat listings — research & design rationale

Research behind Roomio's **Browse flats** feature (the `listings` view + the `scripts/scrape-listings.mjs` pipeline). It documents *why* the feature exists and *how* the findings shaped the UI.

## 1. The problem: brokerage in India

Renting a flat in India almost always routes through a broker who charges a fee with **no legal regulation** on the amount:

- Typically **0.5–1 month's rent**, and up to **2–3 months' rent** in premium tier-1 localities (Mumbai/Bengaluru). ([NoBroker forum](https://www.nobroker.in/forum/what-is-the-going-broker-fees-is-it-one-month/), [Navaghar](https://navaghar.com/brokerage-fees-in-india-explained/), [99acres](https://www.99acres.com/articles/brokerage-charges-for-renting-a-flat.html))
- The **tenant usually pays**, and there are frequent **hidden charges** ("service fee", "paperwork", "processing") added after the deal. ([Quora](https://www.quora.com/In-India-who-pays-the-brokerage-for-finding-a-rental-property-the-landlord-or-the-tenant))
- Forums repeatedly frame brokers as commission-first middlemen; people actively look for ways to go direct.

## 2. What "NoBroker" is (the model to emulate)

[NoBroker](https://www.nobroker.in/) (founded 2014, Bengaluru, IIT alumni) is India's brokerage-free rental/sale marketplace. Its one structural bet: **disintermediate the transaction — connect owners directly with tenants, no broker, no brokerage.** ([Wikipedia](https://en.wikipedia.org/wiki/NoBroker), [The Growth Loop](https://thegrowthloop.beehiiv.com/p/how-nobroker-grows), [markhub24](https://www.markhub24.com/post/nobroker-s-direct-property-listing-without-brokerage-model))

- **Owners list free; seekers browse free** — the platform explicitly **prohibits broker listings** (its supply side is owner-only), unlike 99acres/MagicBricks which monetise broker subscriptions.
- A "**Broker Buster**" AI detects and bans brokers; listings are **verified** to cut fakes/scams. OCR even reads the owner's phone off a "To-Let" board photo. ([businessmodelcanvas](https://businessmodelcanvastemplate.com/blogs/how-it-works/nobroker-how-it-works))
- **Revenue** = optional owner/tenant subscriptions (contact more owners, visit assistance, rent agreements) — the free tier gates the number of owner contacts. ([StartupTalky](https://startuptalky.com/nobroker-business-model/))

## 3. Where the supply already lives: Facebook flatmate groups

Before NoBroker-style apps, and still today, Indians coordinate broker-free rentals in **Facebook groups** like "Flat & Flatmates – Andheri / Thane / …" and "Flat and flatmates in mumbai without brokerage" (147K members). People post their flat directly (photos, rent, locality, phone) — no middleman. ([Quora – finding flatmates](https://www.quora.com/How-do-I-find-flatmates-in-Pune), [Inoreader](https://www.inoreader.com/blog/2018/06/how-to-convert-public-facebook-pages-to-rss-feeds.html))

**Roomio's angle:** these groups are the free supply but the UX is terrible — an infinite, unsorted, unfilterable feed mixed with chatter and reels. Roomio **aggregates those direct owner posts into a clean, searchable, recency-sorted listings page** — the NoBroker experience over content that's already broker-free.

## 4. Listing-card UX principles (applied)

From real-estate card/UX best practices ([Onething](https://www.onething.design/post/real-estate-app-ux), [UXPin](https://www.uxpin.com/studio/blog/card-design-ui/), [Eleken](https://www.eleken.co/blog-posts/card-ui-examples-and-best-practices-for-product-owners)):

| Principle | In Roomio's `Listings.tsx` |
| --- | --- |
| Essentials on top: price, location, type | Rent pill + 📍locality + BHK/gender/occupancy chips |
| Photos/video prominent | Card media = the post's own flat photos (inline video when the post has one) |
| Comparable cards, whitespace | Responsive card grid, clean cream palette |
| Actions in the footer | **Call** button (`tel:`) + View-post link |
| Sort/filter for high-stakes browsing | Newest-first (post time), + search / BHK / gender / photos filters |

**Contact = the valuable action** (NoBroker even gates it). Roomio makes it one tap: a **Call the owner** button per listing. *Product decision (per user):* the number is shown **openly** — no hiding/gating — plus the Call button for convenience.

## 5. How the pipeline stays broker-free & correct

- Scrapes a group's posts via GraphQL, keeps **OFFERING** posts (someone posting a flat) and **drops SEEKING** posts (people asking) — so the page is supply, not noise.
- Media (photos/video) is taken from **each post's own node**, so listings show the actual flat — not Facebook's injected "Suggested Reels" or group-album images.
- Sorted by each post's **creation_time** (newest first).

See `scripts/scrape-listings.mjs` (pipeline) and `src/wizard/Listings.tsx` (UI). Entry point: the Start screen offers **Browse flats** vs **design your own room**.
