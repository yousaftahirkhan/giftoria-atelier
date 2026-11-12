# Giftoria Atelier

Website for Giftoria Atelier, a handmade flower and gift studio in Multan.

The site has two separate parts:

| Part | Address | Who uses it |
|---|---|---|
| Storefront | https://giftoria-atelier.pages.dev/ (also `/` on GitHub Pages) | Customers browse products, fill the cart and place the order on WhatsApp. |
| Super admin | https://yousaftahirkhan.github.io/giftoria-atelier/admin/ | The owner manages orders, products, homepage, business details and payments. |

The pages.dev address is a Cloudflare Pages project (`site-proxy/`) that forwards every request to GitHub Pages, so anything
published from the super admin appears there at once. It sends `/admin` to the GitHub Pages address, where the sign-in lives.
To redeploy it: `cd site-proxy && npx wrangler pages deploy public --project-name giftoria-atelier --branch main`.

## How it works

- **Shop content** lives in `data/shop.json` and product photos in `images/`. The storefront reads these files; it cannot change them.
- **The super admin** signs in with GitHub (password and authenticator code). Selecting *Publish changes* saves one commit to this repository, and GitHub Pages updates the website within about a minute.
- **Orders** are saved in `orders.json` in the separate private repository `giftoria-orders`, so customer names, phone numbers and addresses are never public.

## Order flow

1. The customer adds items to the cart, enters delivery details and selects *Place order on WhatsApp*.
2. WhatsApp opens with the order message ready to send to the shop's number.
3. In the super admin, the owner pastes that message under *Orders → Add an order from WhatsApp*, then tracks it from *Awaiting payment* to *Delivered*.

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
