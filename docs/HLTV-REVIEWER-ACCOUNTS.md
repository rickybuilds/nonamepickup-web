# Reviewer usernames and passwords

Accounts are private: there is no public signup. Configured owners create usernames and temporary passwords on the existing `/admin/hltv-review` page. A new user must choose a different password before accessing any demo, statistics, download or review action. All account holders have review/evidence access; only configured owners manage accounts.

## Enable and create your owner account

Pull the website repository in `/var/www/tfcbot`. Keep your existing credential configuration for bootstrap and recovery. Add to `/var/www/tfcbot/api/.env`:

```dotenv
HLTV_REVIEW_ACCOUNTS_ENABLED=true
HLTV_REVIEW_OWNER_USER_IDS=1571924371402915960
```

Restart `tfcapi` with `pm2 restart tfcapi --update-env`, then refresh the review page. Expand **Existing credential login** and sign in using your current credential. Select **Manage users**. Create your own username and temporary password, entering your Discord ID above in the optional Discord field. That links the account to the configured owner identity. Sign out, sign in with your username and temporary password, and choose your own password. Your owner controls remain available.

Do not give another account your owner Discord ID. Owner IDs are set only by the operator in environment configuration; there is no role-promotion endpoint. Owner accounts cannot be disabled from the account panel. The existing private credential remains usable for recovery, including resetting your own account if you forget its password.

## Add reviewers

From **Manage users**, enter their username and a temporary passphrase of 12–128 characters. Discord ID is optional. Share only that username and temporary password privately. They use the same review URL, sign in, and replace the temporary password before opening any evidence. No environment changes or API restart are needed for each new account.

An owner-created account is an explicit grant of website access, independent of `HLTV_REVIEW_ALLOWED_USER_IDS`. That legacy allowlist still restricts legacy credential login and the bot's channel checks. Creating a website account does not change Discord channel permissions. If a reviewer should see Discord alerts too, grant their member access to that private channel, update the bot's user allowlist and restart the bot when appropriate.

Reviewers can use **Change password** at any time. Owners can reset a password (all sessions revoked, new password required) or disable a reviewer (all sessions revoked; login denied). There is no password-recovery email or public reset form. Disabling a username does not revoke any separately configured legacy credential for that Discord ID: remove that legacy hash/allowlist entry and restart the API if it also needs revoking. Historical reviews, assignments, holds and audit records are preserved.

## Storage and sessions

New account login defaults disabled. Passwords are never stored or returned in plaintext; Node's asynchronous scrypt uses independent random salts, N=32768, r=8, p=3 and a 64-byte derived key. At most two password operations run concurrently per API process. Login attempts are bounded per normalized username and client IP using persistent 15-minute counters, including unknown usernames. Unknown or disabled accounts return the same login error. Password changes have a separate per-account attempt limit.

Browser sessions use random opaque bearer credentials stored only in tab memory; the server stores their SHA-256 hashes. Sessions expire after eight hours, with at most five sessions per account. Reloading drops the tab credential; explicit sign-out revokes that session. Password changes and resets revoke all previous sessions. Every authenticated request rechecks account status, expiry and the first-login password-change restriction. Credentials are sent in Authorization headers, not cookies or URLs. HTTPS remains required; existing API rate limits also apply. No new cookie/CSRF secret or Nginx location is needed because these endpoints use the existing `/api/` proxy.

Account changes and successful logins are attributed in the existing private audit log. Accounts with a linked Discord ID retain that actor ID; others receive a stable `reviewer:<uuid>` identity. Passwords and raw session credentials are excluded from audits and user-list responses. Back up the private registry database securely because it now contains password hashes and sessions as well as evidence metadata.
