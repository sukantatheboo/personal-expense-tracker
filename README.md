<p align="center">
  <a href="https://sukantatheboo.github.io/personal-expense-tracker/">
    <img src="./public/favicon.svg" width="72" alt="Spend logo" />
  </a>
</p>

# Spend — Personal Expense Tracker

Spend is a simple React app for tracking everyday expenses, budgets, recurring payments, and bKash or bank balances.

## ✨ Features

- Add, search, categorize, and export expenses.
- Review monthly totals and spending categories.
- Set monthly budgets.
- Track balances, income, transfers, and account activity.
- Manage recurring expenses and optional due-date reminders.
- Use light or dark mode and install the app on supported devices.
- Sign in to sync your data with Supabase.

## 🚀 Run locally

```sh
npm ci
npm run dev
```

Create a production build with:

```sh
npm run build
```

## 📱 Native iOS app

Spend uses Capacitor Haptics for native iPhone feedback. To sync and open the iOS
project on a Mac with Xcode installed:

```sh
npm ci
npm run open:ios
```

The native app has its own on-device browser storage. Existing data in Safari or
the installed web app does not move automatically; export a JSON backup there,
then restore it from Settings in the native app if needed.

The app is deployed to [GitHub Pages](https://sukantatheboo.github.io/personal-expense-tracker/) when `main` is updated.

## 🔐 Data and privacy

- Data is stored in browser storage by default.
- Signed-in users get automatic Supabase cloud sync.
- Account settings and account activity are synchronized to validated, normalized Supabase tables with a per-user change history. The legacy snapshot copy is retained for compatibility and rollback.
- Realtime updates refresh signed-in devices when another device changes synced data.
- Each account has its own local and cloud data.
- Supabase row-level security protects synced records.
- Cloud sync is not an archival backup.
- Currency conversion sends only the selected currency pair to [Frankfurter](https://frankfurter.dev/).
- Never store bank credentials, bKash PINs, OTPs, or private API keys in this repository.

## 🔔 Optional cloud setup

Sign-in and cloud sync require:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Apply every SQL migration in `supabase/migrations` to the Supabase project before deploying the app. The normalized account and live-sync migration adds the required tables to the `supabase_realtime` publication and backfills existing account settings and activity.

Background push reminders additionally require:

```env
VITE_VAPID_PUBLIC_KEY=your-public-vapid-key
```

Deploy the worker and add its server-only secrets:

```sh
supabase functions deploy send-due-reminders --project-ref YOUR_PROJECT_REF
supabase secrets set --project-ref YOUR_PROJECT_REF \
  CRON_SECRET='replace-with-a-long-random-secret' \
  VAPID_PUBLIC_KEY='your-public-vapid-key' \
  VAPID_PRIVATE_KEY='your-private-vapid-key' \
  VAPID_SUBJECT='mailto:you@example.com'
```

Create these three Vault secrets in the Supabase SQL Editor, using the same `CRON_SECRET` as the Edge Function secret and the public anon key from your app configuration:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'spend_supabase_url');
select vault.create_secret('<VITE_SUPABASE_ANON_KEY>', 'spend_anon_key');
select vault.create_secret('<same-long-random-secret>', 'spend_cron_secret');
```

The scheduler migration may be applied before or after these Vault values; it checks Vault on each run and stays idle until all three values exist. It invokes the worker once per minute. Keep the VAPID private key and cron secret out of the frontend and repository. See [`.env.example`](./.env.example) for the local frontend configuration template.
