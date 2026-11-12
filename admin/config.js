/* Where the super admin reads and saves data, and how it signs in. None of these values are secret.
   owner             - the GitHub account that hosts the website
   repo              - the public website repository (shop content and photos)
   ordersRepo        - the private repository that stores customer orders
   admins            - GitHub usernames allowed to use "Sign in with GitHub" or an access token
   authUrl           - the sign-in service (auth-worker/) on Cloudflare
   googleClientId    - Google sign-in (step 1 of the main sign-in; step 2 is the authenticator code)
   githubAppClientId - "Sign in with GitHub" (the Giftoria Atelier Admin GitHub App) */
window.ADMIN_CONFIG = {
  owner: "yousaftahirkhan",
  repo: "giftoria-atelier",
  branch: "main",
  ordersRepo: "giftoria-orders",
  admins: ["yousaftahirkhan"],
  authUrl: "https://giftoria-auth.giftoria-atelier.workers.dev",
  googleClientId: "1053200574750-jp3u1ddiobmnlsh4pnh3tvp5fcpb0i9d.apps.googleusercontent.com",
  githubAppClientId: "Iv23lih9733oMDWePRSR"
};
