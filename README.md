# Giftoria Atelier

Website for Giftoria Atelier, a handmade flower and gift studio in Multan.

The site has two separate parts:

| Part | Address | Who uses it |
|---|---|---|
| Storefront | `/` | Customers browse products, fill the cart and place the order on WhatsApp. |
| Super admin | `/admin/` | The owner manages orders, products, homepage, business details and payments. |

## How it works

- **Shop content** lives in `data/shop.json` and product photos in `images/`. The storefront reads these files; it cannot change them.
- **The super admin** signs in with a GitHub fine-grained access token. Selecting *Publish changes* saves one commit to this repository, and GitHub Pages updates the website within about a minute.
- **Orders** are saved in `orders.json` in the separate private repository `giftoria-orders`, so customer names, phone numbers and addresses are never public.

## Order flow

1. The customer adds items to the cart, enters delivery details and selects *Place order on WhatsApp*.
2. WhatsApp opens with the order message ready to send to the shop's number.
3. In the super admin, the owner pastes that message under *Orders → Add an order from WhatsApp*, then tracks it from *Awaiting payment* to *Delivered*.

## Access token for the super admin

Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with:

- **Repository access:** only `giftoria-atelier` and `giftoria-orders`
- **Permissions:** Contents → Read and write

## Files

```
index.html          storefront
assets/             shared styles and scripts (base.css, common.js) and storefront code
admin/              super admin (index.html, admin.js, admin.css, config.js)
data/shop.json      shop content
images/             product and site photos
```
