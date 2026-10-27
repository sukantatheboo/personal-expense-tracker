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

The private VAPID key and cron secret must stay in Supabase secrets. See [`.env.example`](./.env.example) for the local configuration template.
