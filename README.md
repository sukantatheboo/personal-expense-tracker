<p align="center">
  <a href="https://sukantatheboo.github.io/personal-expense-tracker/">
    <img src="./public/favicon.svg" width="80" alt="Spend logo" />
  </a>
</p>

# Spend — Personal Expense Tracker

A React app for tracking everyday spending, monthly budgets, recurring expenses, and bKash/Bank balances.

## Features

- Add and search expenses, assign categories and payment accounts, and fill in missing amounts later.
- Review monthly totals and export the selected month and filters as CSV.
- Set monthly budgets and track spending against them.
- Track bKash and bank balances from starting amounts, linked expenses, income, transfers, and adjustments.
- Schedule weekly or monthly expenses. Due entries are added when the app is open; optional background push reminders can notify you when it is closed.
- Convert monthly totals to another currency using estimated rates from [Frankfurter](https://frankfurter.dev/).
- Switch between light and dark themes.
- Install Spend from Chrome's menu on a supported mobile or desktop browser. After opening the app online once, its app shell is available offline.

## Run locally

```sh
npm ci
npm run dev
```

Create a production build with `npm run build`. The site is built and deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml` whenever `main` is updated.

## Data and privacy

- Expenses, budgets, recurring schedules, account balances, and preferences are stored in this browser's local storage by default. After signing in, you can explicitly enable **Expense cloud sync** to store those records in your Supabase project and sync them when you enable sync on another device. Supabase applies row-level security so each signed-in user can access only their own cloud data.
- On first sync, local records are uploaded if no cloud copy exists. If both copies contain data, Spend merges records by ID, with local records taking precedence for matching IDs and local monthly budgets taking precedence for matching months. Simultaneous edits from multiple devices are guarded by a revision check; if a conflict is detected, refresh the app to load and merge the latest copy.
- Turning off cloud sync pauses uploads but keeps the cloud copy. **Delete cloud copy** removes the synced records from Supabase without deleting local data. Keep using **Download backup** as a separate backup; cloud sync is not an archival backup.
- The app reuses the existing `spend-*` storage keys, so data already saved for the published site remains available when the app is updated on the same origin.
- Use **Download backup** in the app to save all app data and preferences as a JSON file outside the browser. Use **Restore backup** to load it later; restoring replaces the current data. Browser storage is still erased when site data is cleared, so keep the backup file somewhere safe and make new backups regularly.
- The installable app shell can work offline after the first online visit. Currency conversion requires an internet connection.
- Background push notifications require a configured Supabase project, an account in Spend, notification permission, and an installed Home Screen app on iOS 16.4 or later. Reminders are sent at 9:00 AM in the device timezone. Android Chrome supports installed and browser push where notifications are allowed.
- When cloud sync is off, expense history, budgets, and account data stay local. Enabling it uploads expenses and amounts, budgets, recurring schedules, account balances, and account transactions to Supabase. Background push separately stores the account email, push subscription, and reminder details needed to send notifications.
- Currency conversion sends only the currency pair to Frankfurter; no expense amounts or account details are sent.
- The React app is still a public client-side website. React organizes the code and safely renders user-entered text, but it does not hide the source code or protect API secrets. Do not put bank credentials, bKash PINs, OTPs, or private API keys in this repository or browser code.
- Automatic bank or bKash synchronization is not configured. It would require an authorized provider connection and a separate secure backend.
- Clearing this website's browser data erases locally saved information. CSV export is for spreadsheet use; use the full JSON backup to restore all data.

## Background push setup

Background reminders need a Supabase project; GitHub Pages alone cannot send push notifications while the app is closed.

1. Create a Supabase project. In **Authentication → URL Configuration**, set the site URL and allowed redirect URL to `https://sukantatheboo.github.io/personal-expense-tracker/`. Enable email/password sign-in.
2. Install the Supabase CLI, sign in, link the project, and apply the database migrations:

   ```sh
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```

3. Generate a VAPID key pair with `npx --yes web-push generate-vapid-keys`. Set the private values on Supabase only (never in GitHub or client code), and deploy the scheduled sender:

   ```sh
   supabase secrets set \
     CRON_SECRET=YOUR_RANDOM_SECRET \
     VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY \
     VAPID_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY \
     VAPID_SUBJECT=mailto:YOUR_EMAIL
   supabase functions deploy send-due-reminders
   ```

4. In Supabase SQL Editor, replace the project reference and both secret placeholders, then run this once to call the sender every minute. Use the same random cron secret set in step 3:

   ```sql
   select vault.create_secret(
     'https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-due-reminders',
     'spend_push_function_url'
   );
   select vault.create_secret('YOUR_RANDOM_SECRET', 'spend_push_cron_secret');
   select cron.schedule(
     'spend-send-due-reminders',
     '* * * * *',
     $$
       select net.http_post(
         url := (select decrypted_secret from vault.decrypted_secrets where name = 'spend_push_function_url'),
         headers := jsonb_build_object(
           'Content-Type', 'application/json',
           'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'spend_push_cron_secret')
         ),
         body := '{}'::jsonb
       );
     $$
   );
   ```

5. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY` as **Actions variables** in the GitHub repository settings. For local development, copy `.env.example` to `.env` and fill in the same public values. Push a commit to `main` to rebuild the site with push enabled.
6. Open the deployed app, create an account, and enable background reminders. On iPhone/iPad, first use Safari's **Add to Home Screen** and open Spend from its Home Screen icon.

The VAPID private key and cron secret belong only in Supabase secrets or Supabase Vault. The public VAPID key, Supabase project URL, and Supabase anon key are intentionally exposed to the browser.
