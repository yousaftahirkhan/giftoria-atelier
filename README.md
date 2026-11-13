# Giftoria Atelier

Website for Giftoria Atelier, a handmade flower and gift studio in Multan.

The site has two separate parts:

| Part | Address | Who uses it |
|---|---|---|
| Storefront | https://giftoria-atelier.pages.dev/ (also `/` on GitHub Pages) | Customers browse products, fill the cart and place the order on WhatsApp. |
| Super admin | https://giftoria-atelier.pages.dev/admin/ | The owner manages orders, products, homepage, business details and payments. |

The pages.dev address is a Cloudflare Pages project (`site-proxy/`) that forwards every request to GitHub Pages, so anything
published from the super admin appears there at once. The old github.io addresses forward to pages.dev.
To redeploy it: `cd site-proxy && npx wrangler pages deploy public --project-name giftoria-atelier --branch main`.

## How it works

- **Shop content** lives in `data/shop.json` and product photos in `images/`. The storefront reads these files; it cannot change them.
- **The super admin** signs in with Google plus an authenticator code (see below). Selecting *Publish changes* saves one commit to this repository, and the website updates within about a minute.
- **Website orders** are sent by the storefront to the order service (`auth-worker/`): `POST /proof` stores the customer's payment screenshot and `POST /order` stores the order.
- **Orders and payment screenshots** are saved in the separate private repository `giftoria-orders` (`orders.json` and `proofs/`), so customer details and payments are never public.
- **New order alerts:** while the super admin is open it checks for orders every 20 seconds, plays a chime and shows a banner for each new one.

## Order flow

The shop takes a 50% advance by default (Payments → Advance payment; it can be switched to 100% upfront).

1. The customer fills the cart and delivery details, pays the advance to one of the active payment methods and uploads the payment screenshot at checkout.
2. *Place order on WhatsApp* saves the order and opens WhatsApp with the order message ready to send.
3. In the super admin the order chimes in as *Payment to check*. The owner checks the money in their own app, then selects *Approve advance*; WhatsApp opens with the confirmation.
4. When the order is made, *Order ready · ask for balance* opens WhatsApp with the remaining amount and the accounts; the owner sends a photo of the finished order in the same chat.
5. *Balance received*, then *Assign inDrive rider* (rider details go to the customer on WhatsApp), then *Mark delivered*.

Orders that come only on WhatsApp can be added with *Orders → Add order* by pasting the customer's message.

## Signing in to the super admin

1. **Sign in with Google** using an allowed Google account.
2. **Enter the 6-digit code** from the authenticator app (the "Giftoria Atelier" entry).

Both steps are checked by the sign-in service in `auth-worker/` (Cloudflare, `giftoria-auth.giftoria-atelier.workers.dev`), not in the browser. It then gives the admin a 1-hour key limited to the two shop repositories and renews it while the session lasts (12 hours, or 30 days on a trusted device).

- Allowed Google accounts are kept in the service's private `ALLOWED_EMAILS` setting, not in this repository.
- The GitHub App **Giftoria Atelier Admin** is installed only on `giftoria-atelier` and `giftoria-orders`, with Contents read and write. Its private key, the authenticator secret and the session key are Cloudflare secrets.
- To sign everyone out, change `SESSION_VERSION` in `auth-worker/wrangler.toml` and redeploy. To replace a lost authenticator, set a new `TOTP_SECRET` and scan the new QR code.

**Other ways to sign in:** *Sign in with GitHub* (GitHub account password and GitHub's own authenticator code; GitHub accounts in `admins` and `ALLOWED_USERS` only), or a [fine-grained access token](https://github.com/settings/personal-access-tokens/new) limited to the two repositories with Contents set to Read and write.

To redeploy the sign-in service: `cd auth-worker && npx wrangler deploy`.

## Files

```
index.html          storefront
assets/             shared styles and scripts (base.css, common.js) and storefront code
admin/              super admin (index.html, admin.js, admin.css, config.js)
auth-worker/        sign-in and order service (Cloudflare Worker)
site-proxy/         the giftoria-atelier.pages.dev address (Cloudflare Pages function)
data/shop.json      shop content
images/             product and site photos
```
