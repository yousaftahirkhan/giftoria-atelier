/* Where the super admin reads and saves data.
   owner      - the GitHub account that hosts the website
   repo       - the public website repository (shop content and photos)
   ordersRepo - the private repository that stores customer orders
   admins     - GitHub usernames allowed to use the super admin
   githubAppClientId, authUrl - "Sign in with GitHub": the GitHub App and the sign-in service (auth-worker/) */
window.ADMIN_CONFIG = {
  owner: "yousaftahirkhan",
  repo: "giftoria-atelier",
  branch: "main",
  ordersRepo: "giftoria-orders",
  admins: ["yousaftahirkhan"],
  githubAppClientId: "Iv23lih9733oMDWePRSR",
  authUrl: "https://giftoria-auth.giftoria-atelier.workers.dev"
};
