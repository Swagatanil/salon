# Naya Andaz Salon — Free Backend (Cloudflare Workers + D1)

Salon ki website ab sirf HTML nahi rahi — iske peeche ek poora **free backend** hai:

- **Online booking** — customer form bharta hai, booking database mein save hoti hai (WhatsApp button bhi bacha hua hai).
- **Feedback + reviews** — customer feedback deta hai, aap approve karte ho, tabhi website par dikhta hai.
- **Rate list database se** — service aur price admin panel se badal sakte ho, HTML chhune ki zaroorat nahi.
- **Admin panel** — `/admin` par bookings confirm/cancel, feedback approve, rate list edit.

Sab kuch Cloudflare ke **free plan** par chalta hai: Workers 1,00,000 request/din free, D1 database 5 GB free, credit card ki zaroorat nahi.

---

## 1. Ek baar ka setup (15 minute)

```bash
npm install                      # dependencies
npx wrangler login               # Cloudflare account se login (free signup: dash.cloudflare.com)
npx wrangler d1 create naya-andaz-salon
```

Aakhri command jo `database_id` deti hai, usse `wrangler.toml` mein `REPLACE_WITH_YOUR_D1_DATABASE_ID` ki jagah paste kar dijiye.

Ab tables banaiye aur admin password set kijiye:

```bash
npm run db:remote                            # tables + default rate list
npx wrangler secret put ADMIN_TOKEN          # apna admin password type karein
npm run deploy
```

Deploy ke baad aapko URL milega, jaise `https://naya-andaz-salon.<aapka-subdomain>.workers.dev`.
Website wahin chalti hai, admin panel `.../admin` par.

## 2. Local par chalana (testing ke liye)

```bash
echo 'ADMIN_TOKEN=dev-secret-token' > .dev.vars
npm run db:local
npm run dev        # http://127.0.0.1:8787
```

## 3. Apne hisaab se badalna

| Kya badalna hai | Kahan |
| --- | --- |
| WhatsApp number | `public/index.html` mein `SALON_WHATSAPP_NUMBER` |
| Ek time slot par kitne customer | `wrangler.toml` mein `SLOT_CAPACITY` |
| Service aur rate | Admin panel → Services table |
| Address, timing, photos | `public/index.html` |

## 4. API endpoints

Public:

| Method | Path | Kaam |
| --- | --- | --- |
| GET | `/api/services` | Rate list |
| GET | `/api/reviews` | Approve kiye gaye reviews + average rating |
| GET | `/api/availability?date=YYYY-MM-DD` | Us din kaunse slot bhar chuke hain |
| POST | `/api/bookings` | Nayi booking (`name, phone, service, date, time, note`) |
| POST | `/api/feedback` | Naya feedback (`name, rating, message`) |

Admin (header: `Authorization: Bearer <ADMIN_TOKEN>`):

| Method | Path | Kaam |
| --- | --- | --- |
| GET | `/api/admin/bookings?status=pending` | Booking list + ginti |
| PATCH | `/api/admin/bookings/:id` | `{"status":"confirmed\|done\|cancelled"}` |
| GET | `/api/admin/feedback` | Sabhi feedback |
| PATCH | `/api/admin/feedback/:id` | `{"approved":true}` |
| GET/POST | `/api/admin/services` | Rate list padhna / nayi service |
| PATCH/DELETE | `/api/admin/services/:id` | Service badalna / hataana |

## 5. Suraksha (built-in)

- Admin API token ke bina 401 deta hai; token constant-time compare hota hai.
- Booking validation: naam, 10-ank mobile, sahi date/time, purani date par booking nahi.
- Ek number se din mein 5 se zyada booking nahi (spam rokne ke liye).
- Slot bhar jaane par 409 — double booking nahi hogi.
- Feedback pehle pending rehta hai; aapke approve karne ke baad hi website par dikhta hai.


## Online Payment (Razorpay)

Online pay karne wale customer ko discount milta hai (default 10%, admin panel se badal sakte hain).

1. [razorpay.com](https://razorpay.com) par account banayein aur KYC poori karein. Pehle **Test Mode** me try karein.
2. Dashboard → Settings → API Keys se `Key ID` aur `Key Secret` nikalein.
3. Terminal me:
   ```
   npx wrangler d1 execute naya-andaz-salon --remote --file=migration_add_payments.sql
   npx wrangler secret put RAZORPAY_KEY_ID
   npx wrangler secret put RAZORPAY_KEY_SECRET
   npm run deploy
   ```
4. Admin panel me "Online Payment Discount" se % set karein.

Local test ke liye `.dev.vars` me `RAZORPAY_KEY_ID=...` aur `RAZORPAY_KEY_SECRET=...` (test keys) daalein.
Keys kabhi GitHub par push na karein. Secret sirf `wrangler secret put` se daalein.
