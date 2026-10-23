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
- Schedule weekly or monthly expenses. Due entries are added when the app is open; browser notifications are optional.
- Convert monthly totals to another currency using estimated rates from [Frankfurter](https://frankfurter.dev/).
- Switch between light and dark themes.

## Run locally

```sh
npm ci
npm run dev
```

Create a production build with `npm run build`. The site is built and deployed to GitHub Pages by the workflow in `.github/workflows/deploy.yml` whenever `main` is updated.

## Data and privacy

- Expenses, budgets, recurring schedules, account balances, and preferences stay in this browser's local storage.
- The app reuses the existing `spend-*` storage keys, so data already saved for the published site remains available when the app is updated on the same origin.
- Use **Download backup** in the app to save all app data and preferences as a JSON file outside the browser. Use **Restore backup** to load it later; restoring replaces the current data. Browser storage is still erased when site data is cleared, so keep the backup file somewhere safe and make new backups regularly.
- Expense and account data are not uploaded. Currency conversion sends only the currency pair to Frankfurter; no expense amounts or account details are sent.
- The React app is still a public client-side website. React organizes the code and safely renders user-entered text, but it does not hide the source code or protect API secrets. Do not put bank credentials, bKash PINs, OTPs, or private API keys in this repository or browser code.
- Automatic bank or bKash synchronization is not configured. It would require an authorized provider connection and a separate secure backend.
- Clearing this website's browser data erases locally saved information. CSV export is for spreadsheet use; use the full JSON backup to restore all data.
