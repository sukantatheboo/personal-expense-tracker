<p align="center">
  <a href="https://sukantatheboo.github.io/personal-expense-tracker/">
    <img src="./public/favicon.svg" width="72" alt="Spend logo" />
  </a>
</p>

<h1 align="center">Spend</h1>

<p align="center">
  A simple, private way to understand where your money goes.
</p>

<p align="center">
  <a href="https://sukantatheboo.github.io/personal-expense-tracker/">Live demo</a>
  ·
  <a href="https://github.com/sukantatheboo/personal-expense-tracker/issues">Report an issue</a>
</p>

## Features

| Track | Plan | Manage |
| --- | --- | --- |
| Expenses, income, and transfers | Monthly budgets and category insights | Cash, bank, bKash, cards, and savings |
| Search, filter, categorize, and export | Multi-currency totals and conversion | Recurring expenses and due-date reminders |

- **Private by default** — your data stays in browser storage unless you enable sync.
- **Sync everywhere** — optional Supabase sign-in keeps your data updated across devices.
- **Works your way** — light and dark themes, responsive UI, installable PWA, and native iOS/Android support.
- **Keep control** — encrypted backups, app PIN/biometric lock, and row-level cloud security.

## Run locally

```sh
npm ci
npm run dev
```

Create a production build:

```sh
npm run build
```

## Optional cloud sync

Copy [`.env.example`](./.env.example), add your Supabase credentials, and apply the
migrations in [`supabase/migrations`](./supabase/migrations).

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Push reminders additionally require `VITE_VAPID_PUBLIC_KEY`. Keep server-only
secrets out of the frontend; see the Supabase migration and scheduling files for
the complete deployment setup.

## Native apps

```sh
npm run open:ios
npm run open:android
```

Both commands build the web app, sync Capacitor, and open the native project.
