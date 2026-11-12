# Giftoria Atelier

Website for Giftoria Atelier, a handmade flower and gift studio in Multan.

The site has two separate parts:

| Part | Address | Who uses it |
|---|---|---|
| Storefront | `/` | Customers browse products, fill the cart and place the order on WhatsApp. |
| Super admin | `/admin/` | The owner manages orders, products, homepage, business details and payments. |

## How it works

- **Shop content** lives in `data/shop.json` and product photos in `images/`. The storefront reads these files; it cannot change them.
- **The super admin** signs in with GitHub (password and authenticator code). Selecting *Publish changes* saves one commit to this repository, and GitHub Pages updates the website within about a minute.
- **Orders** are saved in `orders.json` in the separate private repository `giftoria-orders`, so customer names, phone numbers and addresses are never public.

## Order flow

1. The customer adds items to the cart, enters delivery details and selects *Place order on WhatsApp*.
2. WhatsApp opens with the order message ready to send to the shop's number.
3. In the super admin, the owner pastes that message under *Orders → Add an order from WhatsApp*, then tracks it from *Awaiting payment* to *Delivered*.

## Signing in to the super admin

Select **Sign in with GitHub**. GitHub checks the account password and authenticator code (two-factor authentication must stay on for the account), and the admin stays signed in for 8 hours.

- The GitHub App **Giftoria Atelier Admin** is installed only on `giftoria-atelier` and `giftoria-orders`, with Contents read and write.
- The sign-in service in `auth-worker/` runs on Cloudflare at `giftoria-auth.giftoria-atelier.workers.dev`. It swaps GitHub's one-time code for a short-lived token, accepts only the accounts listed in `ALLOWED_USERS`, and keeps the app's client secret out of this public repository.
- Only the GitHub accounts in `admins` (`admin/config.js`) and `ALLOWED_USERS` (`auth-worker/wrangler.toml`) can manage the shop.

**Fallback:** *Use an access token instead* accepts a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to the two repositories, with Contents set to Read and write.

To redeploy the sign-in service: `cd auth-worker && npx wrangler deploy`.

## Files

```
index.html          storefront
assets/             shared styles and scripts (base.css, common.js) and storefront code
admin/              super admin (index.html, admin.js, admin.css, config.js)
auth-worker/        sign-in service for "Sign in with GitHub" (Cloudflare Worker)
data/shop.json      shop content
images/             product and site photos
```
