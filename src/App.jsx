import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES,
  CURRENCIES,
  PRIMARY_CURRENCY,
  STORAGE_KEYS,
  calculateAccountBalance,
  currentMonth,
  formatCurrency,
  formatDate,
  formatMonth,
  isAccountId,
  isValidDateString,
  loadAccountData,
  loadBudgets,
  loadExpenses,
  loadRecurringSchedules,
  localDate,
  makeId,
  nextOccurrenceDate,
  roundMoney,
  writeStorage,
} from "./data.js";

const CURRENCY_API = "https://api.frankfurter.dev/v2";

function loadTheme() {
  try {
    return localStorage.getItem(STORAGE_KEYS.theme) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function loadCurrency() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.currency);
    return saved && /^[A-Z]{3}$/.test(saved) ? saved : "USD";
  } catch {
    return "USD";
  }
}

function accountName(accountId) {
  return accountId === "bkash" ? "bKash" : "Bank";
}

function shiftMonth(monthValue, offset) {
  const [year, month] = (monthValue || currentMonth()).split("-").map(Number);
  const shifted = new Date(year, month - 1 + offset, 1);
  return localDate(shifted).slice(0, 7);
}

function makeExpenseForm() {
  return {
    description: "",
    amount: "",
    category: "Other",
    date: localDate(),
    interval: "none",
    account: "",
  };
}

function makeTransactionForm() {
  return {
    type: "income",
    amount: "",
    date: localDate(),
    note: "",
    account: "bkash",
    direction: "increase",
    fromAccount: "bkash",
    toAccount: "bank",
  };
}

function accountActivityLabel(activity) {
  if (activity.type === "expense")
    return `Expense · ${accountName(activity.account)}`;
  if (activity.type === "income")
    return `Income · ${accountName(activity.account)}`;
  if (activity.type === "adjustment")
    return `${activity.direction === "increase" ? "Balance increased" : "Balance decreased"} · ${accountName(activity.account)}`;
  return `Transfer · ${accountName(activity.fromAccount)} → ${accountName(activity.toAccount)}`;
}

function accountActivityPrefix(activity) {
  if (activity.type === "income") return "+";
  if (activity.type === "adjustment")
    return activity.direction === "increase" ? "+" : "−";
  return activity.type === "expense" ? "−" : "";
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[\t\r ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function App() {
  const [expenses, setExpenses] = useState(loadExpenses);
  const [budgets, setBudgets] = useState(loadBudgets);
  const [recurringSchedules, setRecurringSchedules] = useState(
    loadRecurringSchedules,
  );
  const [accountData, setAccountData] = useState(loadAccountData);
  const [theme, setTheme] = useState(loadTheme);
  const [targetCurrency, setTargetCurrency] = useState(loadCurrency);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [expenseForm, setExpenseForm] = useState(makeExpenseForm);
  const [expenseMessage, setExpenseMessage] = useState("");
  const [transactionForm, setTransactionForm] = useState(makeTransactionForm);
  const [startingBalances, setStartingBalances] = useState(() => {
    const { settings } = loadAccountData();
    return {
      bkash: String(settings.balances.bkash),
      bank: String(settings.balances.bank),
      date: settings.startDate,
    };
  });
  const [budgetAmount, setBudgetAmount] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [editingExpenseId, setEditingExpenseId] = useState(null);
  const [editingAmount, setEditingAmount] = useState("");
  const [conversionOpen, setConversionOpen] = useState(false);
  const [currencyOptions, setCurrencyOptions] = useState(
    CURRENCIES.map(([iso_code, name]) => ({ iso_code, name })),
  );
  const [conversionRate, setConversionRate] = useState(null);
  const [conversionStatus, setConversionStatus] = useState(
    "Choose a currency to see an estimate.",
  );
  const [conversionFailed, setConversionFailed] = useState(false);
  const [recurringReminder, setRecurringReminder] = useState("");
  const [notificationPermission, setNotificationPermission] = useState(() =>
    typeof window !== "undefined" && "Notification" in window
      ? window.Notification.permission
      : "unsupported",
  );
  const [notificationStatus, setNotificationStatus] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const backupFileInputRef = useRef(null);
  const pendingDueRef = useRef([]);
  const lastRecurringCheckRef = useRef("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Keep the selected theme for this visit when storage is unavailable.
    }
  }, [theme]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.expenses, expenses);
  }, [expenses]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.budgets, budgets);
  }, [budgets]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.recurring, recurringSchedules);
  }, [recurringSchedules]);
  useEffect(() => {
    writeStorage(STORAGE_KEYS.accounts, accountData);
  }, [accountData]);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.currency, targetCurrency);
    } catch {
      // The currency selection still applies until this page is closed.
    }
  }, [targetCurrency]);

  useEffect(() => {
    const { settings } = accountData;
    setStartingBalances({
      bkash: String(settings.balances.bkash),
      bank: String(settings.balances.bank),
      date: settings.startDate,
    });
  }, [accountData.settings]);

  useEffect(() => {
    const budget = Number(budgets[selectedMonth] || 0);
    setBudgetAmount(budget > 0 ? String(budget) : "");
  }, [budgets, selectedMonth]);

  const monthExpenses = useMemo(
    () => expenses.filter((expense) => expense.date.slice(0, 7) === selectedMonth),
    [expenses, selectedMonth],
  );
  const monthlyTotal = useMemo(
    () =>
      monthExpenses.reduce(
        (sum, expense) =>
          sum + (expense.amount === null ? 0 : Number(expense.amount)),
        0,
      ),
    [monthExpenses],
  );
  const visibleExpenses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return monthExpenses
      .filter((expense) => !categoryFilter || expense.category === categoryFilter)
      .filter(
        (expense) =>
          !normalizedQuery ||
          `${expense.description} ${expense.category}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
      )
      .sort(
        (a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
      );
  }, [monthExpenses, categoryFilter, query]);
  const accountBalances = useMemo(
    () => ({
      bkash: calculateAccountBalance("bkash", expenses, accountData),
      bank: calculateAccountBalance("bank", expenses, accountData),
    }),
    [expenses, accountData],
  );
  const accountActivity = useMemo(() => {
    const expenseActivity = expenses
      .filter(
        (expense) =>
          isAccountId(expense.account) &&
          expense.amount !== null &&
          expense.date >= accountData.settings.startDate,
      )
      .map((expense) => ({ ...expense, type: "expense" }));
    const trackedTransactions = accountData.transactions.filter(
      (transaction) => transaction.date >= accountData.settings.startDate,
    );
    return [...trackedTransactions, ...expenseActivity]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 8);
  }, [expenses, accountData]);

  const monthBudget = Number(budgets[selectedMonth] || 0);
  const budgetPercentage = monthBudget > 0 ? (monthlyTotal / monthBudget) * 100 : 0;
  const budgetProgress = Math.min(100, Math.max(0, budgetPercentage));
  const conversionReady = conversionOpen && conversionRate !== null;

  function notifyDueExpenses(dueExpenses) {
    if (!dueExpenses.length) return;
    pendingDueRef.current.push(...dueExpenses);
    const details = dueExpenses
      .map((expense) => `${expense.description} (${formatDate(expense.date)})`)
      .join(", ");
    setRecurringReminder(
      dueExpenses.length === 1
        ? dueExpenses[0].date === localDate()
          ? `${dueExpenses[0].description} is due today and was added to your expenses.`
          : `${dueExpenses[0].description} was overdue and was added to your expenses.`
        : `Recurring expenses due today or earlier were added: ${details}.`,
    );
    if (notificationPermission === "granted") sendSystemNotification(dueExpenses);
  }

  function sendSystemNotification(dueExpenses) {
    if (!("Notification" in window) || window.Notification.permission !== "granted")
      return;
    const details = dueExpenses
      .map((expense) => `${expense.description} (${formatDate(expense.date)})`)
      .join(", ");
    try {
      new window.Notification(
        dueExpenses.length === 1
          ? "Recurring expense due"
          : "Recurring expenses due",
        { body: details },
      );
      pendingDueRef.current = pendingDueRef.current.filter(
        (pending) => !dueExpenses.includes(pending),
      );
    } catch (error) {
      setNotificationStatus(`Could not show a system notification: ${error.message}`);
    }
  }

  const processDueSchedules = useRef(null);
  processDueSchedules.current = () => {
    const today = localDate();
    if (lastRecurringCheckRef.current === today) return;
    lastRecurringCheckRef.current = today;
    const nextExpenses = [...expenses];
    let expensesChanged = false;
    let schedulesChanged = false;
    const dueExpenses = [];
    const nextSchedules = recurringSchedules.map((schedule) => {
      if (!schedule.active) return schedule;
      let nextDate = schedule.nextDate;
      let generated = 0;
      while (nextDate <= today && generated < 240) {
        const exists = nextExpenses.some(
          (expense) =>
            expense.recurringId === schedule.id && expense.date === nextDate,
        );
        if (!exists) {
          nextExpenses.push({
            id: makeId(),
            description: schedule.description,
            amount: Number(schedule.amount),
            category: schedule.category,
            date: nextDate,
            account: isAccountId(schedule.account) ? schedule.account : "",
            recurringId: schedule.id,
          });
          dueExpenses.push({ description: schedule.description, date: nextDate });
          expensesChanged = true;
        }
        nextDate = nextOccurrenceDate(
          nextDate,
          schedule.interval,
          schedule.dayOfMonth,
        );
        generated += 1;
        schedulesChanged = true;
      }
      return schedulesChanged && nextDate !== schedule.nextDate
        ? { ...schedule, nextDate }
        : schedule;
    });
    if (expensesChanged) setExpenses(nextExpenses);
    if (schedulesChanged) setRecurringSchedules(nextSchedules);
    notifyDueExpenses(dueExpenses);
  };

  useEffect(() => {
    processDueSchedules.current?.();
    const timer = window.setInterval(
      () => processDueSchedules.current?.(),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!conversionOpen) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    async function fetchRate() {
      setConversionStatus(`Getting the latest available ${targetCurrency} rate…`);
      setConversionFailed(false);
      setConversionRate(null);
      try {
        const currenciesResponse = await fetch(`${CURRENCY_API}/currencies`, {
          signal: controller.signal,
        });
        if (currenciesResponse.ok) {
          const values = await currenciesResponse.json();
          if (Array.isArray(values)) {
            const cleanCurrencies = values
              .filter(
                (item) =>
                  item &&
                  /^[A-Z]{3}$/.test(item.iso_code) &&
                  item.iso_code !== PRIMARY_CURRENCY &&
                  typeof item.name === "string",
              )
              .sort((a, b) => a.name.localeCompare(b.name));
            if (cleanCurrencies.length && !cancelled) {
              setCurrencyOptions(cleanCurrencies);
              if (!cleanCurrencies.some((item) => item.iso_code === targetCurrency))
                setTargetCurrency(
                  cleanCurrencies.some((item) => item.iso_code === "USD")
                    ? "USD"
                    : cleanCurrencies[0].iso_code,
                );
            }
          }
        }
        const response = await fetch(
          `${CURRENCY_API}/rate/${PRIMARY_CURRENCY.toLowerCase()}/${targetCurrency.toLowerCase()}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Exchange rate request failed");
        const data = await response.json();
        const rate = Number(data.rate);
        if (
          cancelled ||
          data.base !== PRIMARY_CURRENCY ||
          data.quote !== targetCurrency ||
          !Number.isFinite(rate) ||
          rate <= 0 ||
          typeof data.date !== "string"
        )
          throw new Error("Exchange rate response was invalid");
        setConversionRate(rate);
        const rateText = new Intl.NumberFormat(undefined, {
          maximumSignificantDigits: 6,
        }).format(rate);
        setConversionStatus(
          `Rate: 1 BDT = ${rateText} ${targetCurrency}. Rate date: ${data.date}.`,
        );
      } catch (error) {
        if (cancelled || error.name === "AbortError") return;
        setConversionRate(null);
        setConversionFailed(true);
        setConversionStatus(
          `Could not load a ${targetCurrency} rate. Check your connection, then try again.`,
        );
      }
    }
    fetchRate();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [conversionOpen, targetCurrency]);

  function handleExpenseSubmit(event) {
    event.preventDefault();
    const description = expenseForm.description.trim();
    const rawAmount = expenseForm.amount.trim();
    const amount = rawAmount === "" ? null : Number(rawAmount);
    if (
      !description ||
      !isValidDateString(expenseForm.date) ||
      (amount !== null && (!Number.isFinite(amount) || amount <= 0)) ||
      (expenseForm.interval !== "none" && amount === null)
    ) {
      setExpenseMessage(
        expenseForm.interval !== "none" && amount === null
          ? "Recurring expenses need an amount."
          : "Check the description, amount, and date, then try again.",
      );
      return;
    }
    setExpenseMessage("");
    if (expenseForm.interval === "none") {
      setExpenses((current) => [
        ...current,
        {
          id: makeId(),
          description,
          amount: amount === null ? null : roundMoney(amount),
          category: expenseForm.category,
          date: expenseForm.date,
          account: expenseForm.account,
        },
      ]);
    } else {
      const scheduleId = makeId();
      let nextDate = expenseForm.date;
      const today = localDate();
      const generatedExpenses = [];
      let generated = 0;
      while (nextDate <= today && generated < 240) {
        generatedExpenses.push({
          id: makeId(),
          description,
          amount: roundMoney(amount),
          category: expenseForm.category,
          date: nextDate,
          account: expenseForm.account,
          recurringId: scheduleId,
        });
        nextDate = nextOccurrenceDate(
          nextDate,
          expenseForm.interval,
          Number(expenseForm.date.slice(-2)),
        );
        generated += 1;
      }
      setRecurringSchedules((current) => [
        ...current,
        {
          id: scheduleId,
          description,
          amount: roundMoney(amount),
          category: expenseForm.category,
          interval: expenseForm.interval,
          account: expenseForm.account,
          dayOfMonth: Number(expenseForm.date.slice(-2)),
          nextDate,
          active: true,
        },
      ]);
      if (generatedExpenses.length) {
        setExpenses((current) => [...current, ...generatedExpenses]);
        notifyDueExpenses(
          generatedExpenses.map((expense) => ({
            description: expense.description,
            date: expense.date,
          })),
        );
      }
    }
    setSelectedMonth(expenseForm.date.slice(0, 7));
    setExpenseForm(makeExpenseForm());
  }

  function handleOpeningBalancesSubmit(event) {
    event.preventDefault();
    const bkash = Number(startingBalances.bkash);
    const bank = Number(startingBalances.bank);
    if (
      !Number.isFinite(bkash) ||
      bkash < 0 ||
      !Number.isFinite(bank) ||
      bank < 0 ||
      !isValidDateString(startingBalances.date)
    )
      return;
    setAccountData((current) => ({
      ...current,
      settings: {
        startDate: startingBalances.date,
        balances: { bkash: roundMoney(bkash), bank: roundMoney(bank) },
        configured: true,
      },
    }));
  }

  function handleAccountTransactionSubmit(event) {
    event.preventDefault();
    const amount = Number(transactionForm.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !isValidDateString(transactionForm.date))
      return;
    const transaction = {
      id: makeId(),
      type: transactionForm.type,
      amount: roundMoney(amount),
      date: transactionForm.date,
      description: transactionForm.note.trim(),
    };
    if (transactionForm.type === "income") {
      transaction.account = transactionForm.account;
    } else if (transactionForm.type === "adjustment") {
      transaction.account = transactionForm.account;
      transaction.direction = transactionForm.direction;
    } else if (transactionForm.type === "transfer") {
      transaction.fromAccount = transactionForm.fromAccount;
      transaction.toAccount = transactionForm.toAccount;
      if (transaction.fromAccount === transaction.toAccount) return;
    } else {
      return;
    }
    setAccountData((current) => ({
      ...current,
      transactions: [...current.transactions, transaction],
    }));
    setTransactionForm(makeTransactionForm());
  }

  function changeTransferAccount(field, value) {
    setTransactionForm((current) => {
      const updated = { ...current, [field]: value };
      if (updated.fromAccount === updated.toAccount) {
        if (field === "fromAccount")
          updated.toAccount = value === "bkash" ? "bank" : "bkash";
        else updated.fromAccount = value === "bkash" ? "bank" : "bkash";
      }
      return updated;
    });
  }

  function saveMissingExpenseAmount(event, expense) {
    event.preventDefault();
    const amount = Number(editingAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setExpenses((current) =>
      current.map((item) =>
        item.id === expense.id ? { ...item, amount: roundMoney(amount) } : item,
      ),
    );
    setEditingExpenseId(null);
    setEditingAmount("");
  }

  function removeAccountActivity(activity) {
    if (activity.type === "expense") {
      setExpenses((current) => current.filter((item) => item.id !== activity.id));
    } else {
      setAccountData((current) => ({
        ...current,
        transactions: current.transactions.filter(
          (item) => item.id !== activity.id,
        ),
      }));
    }
  }

  function saveBudget(event) {
    event.preventDefault();
    const amount = Number(budgetAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setBudgets((current) => ({ ...current, [selectedMonth]: roundMoney(amount) }));
  }

  function clearBudget() {
    setBudgets((current) => {
      const next = { ...current };
      delete next[selectedMonth];
      return next;
    });
  }

  function exportExpenses() {
    if (!visibleExpenses.length) return;
    const data = [
      ["Date", "Description", "Category", "Amount (BDT)", "Payment account", "Type"],
      ...visibleExpenses.map((expense) => [
        expense.date,
        expense.description,
        expense.category,
        expense.amount === null ? "" : expense.amount,
        isAccountId(expense.account) ? accountName(expense.account) : "Cash / Other",
        expense.recurringId ? "Recurring" : "One-time",
      ]),
    ];
    const csv = `\uFEFF${data
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-${selectedMonth}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadBackup() {
    const backup = {
      format: "spend-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        expenses,
        budgets,
        recurringSchedules,
        accountData,
        theme,
        targetCurrency,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `spend-backup-${localDate()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setBackupStatus("Backup downloaded. Keep it somewhere safe.");
  }

  async function restoreBackup(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const data = backup?.data;
      if (
        backup?.format !== "spend-backup" ||
        backup?.version !== 1 ||
        !Array.isArray(data?.expenses) ||
        !data.budgets ||
        typeof data.budgets !== "object" ||
        Array.isArray(data.budgets) ||
        !Array.isArray(data?.recurringSchedules) ||
        !data.accountData ||
        typeof data.accountData !== "object" ||
        !data.accountData.settings ||
        !data.accountData.settings.balances ||
        !Array.isArray(data.accountData.transactions) ||
        !["light", "dark"].includes(data.theme) ||
        typeof data.targetCurrency !== "string" ||
        !/^[A-Z]{3}$/.test(data.targetCurrency)
      ) {
        throw new Error("This file is not a valid Spend backup.");
      }
      if (!window.confirm("Restoring this backup will replace all current app data. Continue?")) {
        setBackupStatus("Restore canceled.");
        return;
      }
      setExpenses(loadExpenses(data.expenses));
      setBudgets(loadBudgets(data.budgets));
      setRecurringSchedules(loadRecurringSchedules(data.recurringSchedules));
      setAccountData(loadAccountData(data.accountData));
      setTheme(data.theme);
      setTargetCurrency(data.targetCurrency);
      setBackupStatus("Backup restored.");
    } catch (error) {
      setBackupStatus(`Could not restore backup: ${error.message}`);
    } finally {
      input.value = "";
    }
  }

  async function toggleNotifications() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setNotificationStatus("System notifications are not supported by this browser.");
      return;
    }
    let permission = window.Notification.permission;
    if (permission === "default") {
      try {
        permission = await window.Notification.requestPermission();
      } catch (error) {
        setNotificationStatus(`Could not request notification permission: ${error.message}`);
        return;
      }
    }
    setNotificationPermission(permission);
    if (permission === "denied") {
      setNotificationStatus("Allow notifications for this site in your browser settings, then reload the app.");
      return;
    }
    if (pendingDueRef.current.length) {
      const pending = [...pendingDueRef.current];
      sendSystemNotification(pending);
    } else {
      try {
        new window.Notification("Spend notifications enabled", {
          body: "System notifications are working.",
        });
      } catch (error) {
        setNotificationStatus(`Could not show a system notification: ${error.message}`);
      }
    }
  }

  useEffect(() => {
    if (notificationPermission === "unsupported") {
      setNotificationStatus("System notifications are not supported by this browser.");
    } else if (notificationPermission === "granted") {
      setNotificationStatus("System notifications are enabled. They appear while this app is open.");
    } else if (notificationPermission === "denied") {
      setNotificationStatus("Allow notifications for this site in your browser settings, then reload the app.");
    } else {
      setNotificationStatus("Allow notifications to get reminders while this app is open.");
    }
  }, [notificationPermission]);

  function toggleConversion() {
    setConversionOpen((open) => !open);
  }

  function retryConversion() {
    // Changing the target to itself triggers a fresh request through the effect.
    setConversionOpen(false);
    window.setTimeout(() => setConversionOpen(true), 0);
  }

  function addMonth(offset) {
    setSelectedMonth((month) => shiftMonth(month, offset));
  }

  const countText =
    visibleExpenses.length === monthExpenses.length
      ? `${visibleExpenses.length} ${visibleExpenses.length === 1 ? "expense" : "expenses"}`
      : `${visibleExpenses.length} of ${monthExpenses.length} shown`;

  return (
    <main>
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">↗</span>
          <span>Spend</span>
        </div>
        <div className="header-actions">
          <div className="local-note">Your data stays on this device</div>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            aria-pressed={theme === "dark"}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
            <span className="theme-label">{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </header>

      <section className="summary" aria-labelledby="summary-title">
        <div className="summary-topline">
          <p className="eyebrow" id="summary-title"><span className="summary-label-prefix">Month total · </span>BDT</p>
          <div className="month-navigation" aria-label="Monthly total navigation">
            <button className="month-step" type="button" aria-label="Previous month" title="Previous month" onClick={() => addMonth(-1)}>‹</button>
            <label className="month-select">
              <span className="month-display" aria-hidden="true">
                <span>{formatMonth(selectedMonth)}</span>
                <span className="month-calendar-icon" />
              </span>
              <input
                className="month-picker"
                type="month"
                aria-label="Choose month"
                title="Choose month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value || currentMonth())}
              />
            </label>
            <button className="month-step" type="button" aria-label="Next month" title="Next month" onClick={() => addMonth(1)}>›</button>
          </div>
        </div>
        <p className="total" aria-live="polite">{formatCurrency(monthlyTotal)}</p>
        <p className="summary-caption">Across all expenses in {formatMonth(selectedMonth)}</p>
        <button
          className="conversion-toggle"
          type="button"
          aria-expanded={conversionOpen}
          onClick={toggleConversion}
        >
          <span>{conversionOpen ? "Hide conversion" : "Show conversion"}</span>
        <span id="conversion-toggle-icon" aria-hidden="true">{conversionOpen ? "⌃" : "⌄"}</span>
        </button>
        {conversionOpen && (
          <div className="conversion-details">
            <div className="conversion-picker">
              <label htmlFor="conversion-currency">Convert BDT to</label>
              <select
                id="conversion-currency"
                value={targetCurrency}
                onChange={(event) => setTargetCurrency(event.target.value)}
              >
                {currencyOptions.map((currency) => (
                  <option key={currency.iso_code} value={currency.iso_code}>
                    {currency.iso_code} — {currency.name}
                  </option>
                ))}
              </select>
            </div>
            {conversionReady && (
              <div className="converted-total-block">
                <p className="converted-total-label">Estimated total in {targetCurrency}</p>
                <p className="converted-total" aria-live="polite">
                  {formatCurrency(monthlyTotal * conversionRate, targetCurrency)}
                </p>
              </div>
            )}
            <p className="conversion-status" role="status" aria-live="polite">
              {conversionStatus}
            </p>
            <p className="conversion-disclaimer">
              Indicative daily mid-market rate. Your bank or card provider may use a different rate. Source: <a href="https://frankfurter.dev/" target="_blank" rel="noopener noreferrer">Frankfurter</a>.
            </p>
            {conversionFailed && (
              <button className="retry-rate" type="button" onClick={retryConversion}>Try again</button>
            )}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="form-title">
        <h2 id="form-title">Add an expense</h2>
        <form
          id="expense-form"
          onSubmit={handleExpenseSubmit}
          onChange={() => expenseMessage && setExpenseMessage("")}
        >
          <div className="form-grid">
            <div className="description-field">
              <label htmlFor="description">What was it for?</label>
              <input
                id="description"
                type="text"
                placeholder="e.g. Lunch"
                maxLength="80"
                required
                autoComplete="off"
                value={expenseForm.description}
                onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="amount">Amount (BDT)</label>
              <input
                id="amount"
                type="number"
                placeholder="0.00"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                required={expenseForm.interval !== "none"}
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="expense-category">Category</label>
              <select
                id="expense-category"
                value={expenseForm.category}
                onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}
              >
                {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="expense-date">Date</label>
              <input
                id="expense-date"
                type="date"
                required
                value={expenseForm.date}
                onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })}
              />
            </div>
            <div>
              <label htmlFor="expense-repeat">Repeat</label>
              <select
                id="expense-repeat"
                value={expenseForm.interval}
                onChange={(event) => setExpenseForm({ ...expenseForm, interval: event.target.value })}
              >
                <option value="none">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label htmlFor="expense-account">Paid from</label>
              <select
                id="expense-account"
                value={expenseForm.account}
                onChange={(event) => setExpenseForm({ ...expenseForm, account: event.target.value })}
              >
                <option value="">Cash / Other (not tracked)</option>
                <option value="bkash">bKash</option>
                <option value="bank">Bank</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <span className="currency-hint">
              {expenseForm.interval === "none"
                ? "Enter amounts in BDT. You can add a missing amount later from Recent expenses."
                : "Recurring expenses need an amount and are added when due."}
            </span>
            <button type="submit">Add expense</button>
          </div>
          {expenseMessage && <p className="form-message" role="alert">{expenseMessage}</p>}
        </form>
      </section>

      <section className="panel" aria-labelledby="accounts-title">
        <div className="account-panel-header">
          <div>
            <h2 id="accounts-title">Account balances</h2>
            <p className="account-intro">Updated as you log expenses and account activity.</p>
          </div>
        </div>
        <div className="account-cards">
          {[
            ["bkash", "bKash"],
            ["bank", "Bank"],
          ].map(([id, label]) => (
            <article className="account-card" key={id}>
              <div className="account-card-copy">
                <h3 className="account-card-heading">{label}</h3>
                <p className="account-meta">
                  {accountData.settings.configured
                    ? `Since ${formatDate(accountData.settings.startDate)}`
                    : "Starting amount needed"}
                </p>
              </div>
              <p className="account-balance" aria-live="polite">
                {formatCurrency(accountBalances[id])}
              </p>
            </article>
          ))}
        </div>

        <details className="account-details">
          <summary>Set starting balances</summary>
          <form onSubmit={handleOpeningBalancesSubmit}>
            <div className="account-form-grid">
              <div>
                <label htmlFor="starting-bkash">bKash (BDT)</label>
                <input
                  id="starting-bkash"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={startingBalances.bkash}
                  onChange={(event) => setStartingBalances({ ...startingBalances, bkash: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="starting-bank">Bank (BDT)</label>
                <input
                  id="starting-bank"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={startingBalances.bank}
                  onChange={(event) => setStartingBalances({ ...startingBalances, bank: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="starting-date">Balances as of</label>
                <input
                  id="starting-date"
                  type="date"
                  required
                  value={startingBalances.date}
                  onChange={(event) => setStartingBalances({ ...startingBalances, date: event.target.value })}
                />
              </div>
            </div>
            <div className="account-form-actions">
              <button type="submit">Save starting balances</button>
            </div>
            <p className="account-form-note">
              Earlier expenses stay in history and won’t change these starting balances.
            </p>
          </form>
        </details>

        <details className="account-details account-transaction-details">
          <summary>Record income, adjustment, or transfer</summary>
          <form onSubmit={handleAccountTransactionSubmit}>
            <div className="account-form-grid account-transaction-grid">
              <div>
                <label htmlFor="transaction-type">Activity</label>
                <select
                  id="transaction-type"
                  value={transactionForm.type}
                  onChange={(event) => setTransactionForm({ ...transactionForm, type: event.target.value })}
                >
                  <option value="income">Income</option>
                  <option value="adjustment">Balance adjustment</option>
                  <option value="transfer">Transfer between accounts</option>
                </select>
              </div>
              <div>
                <label htmlFor="transaction-amount">Amount (BDT)</label>
                <input
                  id="transaction-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  required
                  value={transactionForm.amount}
                  onChange={(event) => setTransactionForm({ ...transactionForm, amount: event.target.value })}
                />
              </div>
              <div>
                <label htmlFor="transaction-date">Date</label>
                <input
                  id="transaction-date"
                  type="date"
                  required
                  value={transactionForm.date}
                  onChange={(event) => setTransactionForm({ ...transactionForm, date: event.target.value })}
                />
              </div>
              <div className="account-note-field">
                <label htmlFor="transaction-note">Note</label>
                <input
                  id="transaction-note"
                  type="text"
                  maxLength="80"
                  placeholder="e.g. Salary, cash deposit"
                  autoComplete="off"
                  value={transactionForm.note}
                  onChange={(event) => setTransactionForm({ ...transactionForm, note: event.target.value })}
                />
              </div>
              {transactionForm.type !== "transfer" && (
                <div>
                  <label htmlFor="transaction-account">Account</label>
                  <select
                    id="transaction-account"
                    value={transactionForm.account}
                    onChange={(event) => setTransactionForm({ ...transactionForm, account: event.target.value })}
                  >
                    <option value="bkash">bKash</option>
                    <option value="bank">Bank</option>
                  </select>
                </div>
              )}
              {transactionForm.type === "adjustment" && (
                <div>
                  <label htmlFor="adjustment-direction">Correction</label>
                  <select
                    id="adjustment-direction"
                    value={transactionForm.direction}
                    onChange={(event) => setTransactionForm({ ...transactionForm, direction: event.target.value })}
                  >
                    <option value="increase">Increase balance</option>
                    <option value="decrease">Decrease balance</option>
                  </select>
                </div>
              )}
              {transactionForm.type === "transfer" && (
                <>
                  <div>
                    <label htmlFor="transfer-from">From</label>
                    <select
                      id="transfer-from"
                      value={transactionForm.fromAccount}
                      onChange={(event) => changeTransferAccount("fromAccount", event.target.value)}
                    >
                      <option value="bkash">bKash</option>
                      <option value="bank">Bank</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="transfer-to">To</label>
                    <select
                      id="transfer-to"
                      value={transactionForm.toAccount}
                      onChange={(event) => changeTransferAccount("toAccount", event.target.value)}
                    >
                      <option value="bank">Bank</option>
                      <option value="bkash">bKash</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            <div className="account-form-actions">
              <button type="submit">Save activity</button>
            </div>
          </form>
        </details>

        <details className="account-details">
          <summary>Recent account activity</summary>
          {accountActivity.length ? (
            <ul className="account-activity-list">
              {accountActivity.map((activity) => {
                const label = accountActivityLabel(activity);
                return (
                  <li className="account-activity-row" key={activity.id}>
                    <div className="account-activity-info">
                      <div className="account-activity-title">
                        {activity.description ? `${label} · ${activity.description}` : label}
                      </div>
                      <div className="account-activity-date">{formatDate(activity.date)}</div>
                    </div>
                    <span className="account-activity-amount">
                      {accountActivityPrefix(activity)}{formatCurrency(activity.amount)}
                    </span>
                    <button
                      className="remove"
                      type="button"
                      title="Remove account activity"
                      aria-label={`Remove ${label}${activity.description ? ` ${activity.description}` : ""}`}
                      onClick={() => removeAccountActivity(activity)}
                    >×</button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="account-activity-empty">Your recent expenses and account activity will appear here.</p>
          )}
        </details>
      </section>

      <section className="panel" aria-labelledby="budget-title">
        <h2 id="budget-title">Monthly budget</h2>
        <p className="currency-hint">For {formatMonth(selectedMonth)}. All expenses in this month count toward the budget.</p>
        <form className="budget-form" onSubmit={saveBudget}>
          <div className="budget-field">
            <label htmlFor="monthly-budget">Budget (BDT)</label>
            <input
              id="monthly-budget"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              placeholder="e.g. 20000"
              required
              value={budgetAmount}
              onChange={(event) => setBudgetAmount(event.target.value)}
            />
          </div>
          <button type="submit">Save budget</button>
          {monthBudget > 0 && <button className="clear-budget" type="button" onClick={clearBudget}>Clear</button>}
        </form>
        {monthBudget > 0 ? (
          <div className="budget-meter">
            <div
              className="progress-track"
              role="progressbar"
              aria-label="Monthly budget used"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(budgetProgress)}
              aria-valuetext={`${Math.round(budgetPercentage)} percent of budget used`}
            >
              <div
                className="progress-fill"
                style={{
                  width: `${budgetProgress}%`,
                  background: budgetPercentage > 100 ? "var(--danger)" : "var(--green)",
                }}
              />
            </div>
            <div className="budget-summary">
              <span>{formatCurrency(monthlyTotal)} spent</span>
              <span>
                {monthlyTotal <= monthBudget
                  ? `${formatCurrency(monthBudget - monthlyTotal)} left`
                  : `${formatCurrency(monthlyTotal - monthBudget)} over budget`}
              </span>
            </div>
          </div>
        ) : (
          <p className="budget-empty">Add a budget to track your monthly spending.</p>
        )}
      </section>

      <section className="panel" aria-labelledby="recurring-title">
        <h2 id="recurring-title">Recurring expenses</h2>
        <p className="currency-hint">Weekly or monthly entries are added when they come due and you open the app.</p>
        {recurringReminder && (
          <p className="recurring-reminder" role="status" aria-live="polite">{recurringReminder}</p>
        )}
        <div className="notification-controls">
          <button
            className="notification-button"
            type="button"
            disabled={notificationPermission === "denied" || notificationPermission === "unsupported"}
            onClick={toggleNotifications}
          >
            {notificationPermission === "granted"
              ? "Send test notification"
              : notificationPermission === "denied"
                ? "Notifications blocked"
                : "Enable system notifications"}
          </button>
          <p className="notification-status" role="status" aria-live="polite">{notificationStatus}</p>
        </div>
        {recurringSchedules.length ? (
          <ul className="recurring-list">
            {recurringSchedules.map((schedule) => {
              const cadence = schedule.interval === "weekly" ? "Weekly" : "Monthly";
              const paymentAccount = isAccountId(schedule.account) ? ` · ${accountName(schedule.account)}` : "";
              return (
                <li className="recurring-row" key={schedule.id}>
                  <div className="recurring-info">
                    <div className="recurring-name">{schedule.description}</div>
                    <div className="recurring-meta">
                      {schedule.active ? cadence : `Paused · ${cadence}`} · {schedule.category}{paymentAccount} · Next {formatDate(schedule.nextDate)}
                    </div>
                  </div>
                  <span className="recurring-amount">{formatCurrency(schedule.amount)}</span>
                  <button
                    className="recurring-action"
                    type="button"
                    aria-label={`${schedule.active ? "Pause" : "Resume"} ${schedule.description}`}
                    onClick={() => {
                      setRecurringSchedules((current) => current.map((item) => {
                        if (item.id !== schedule.id) return item;
                        if (item.active) return { ...item, active: false };
                        let nextDate = item.nextDate;
                        let skipped = 0;
                        while (nextDate <= localDate() && skipped < 240) {
                          nextDate = nextOccurrenceDate(nextDate, item.interval, item.dayOfMonth);
                          skipped += 1;
                        }
                        return { ...item, active: true, nextDate };
                      }));
                    }}
                  >{schedule.active ? "Pause" : "Resume"}</button>
                  <button
                    className="recurring-action"
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Remove the schedule for “${schedule.description}”? Existing expenses will stay in your list.`)) return;
                      setRecurringSchedules((current) => current.filter((item) => item.id !== schedule.id));
                    }}
                  >Remove</button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="recurring-empty">Choose Weekly or Monthly in the expense form to add a recurring expense.</p>
        )}
      </section>

      <section className="list-panel" aria-labelledby="list-title">
        <div className="list-heading">
          <div className="list-heading-title">
            <h2 id="list-title">Expenses</h2>
            <span className="count">{countText}</span>
          </div>
          <button
            className="export-button"
            type="button"
            disabled={!visibleExpenses.length}
            title="Export the selected month and current filters as a CSV file"
            onClick={exportExpenses}
          >Export CSV</button>
        </div>
        <div className="filters">
          <input
            type="search"
            placeholder="Search expenses"
            aria-label="Search expenses"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
          </select>
        </div>
        {visibleExpenses.length ? (
          <ul id="expense-list" aria-live="polite">
            {visibleExpenses.map((expense) => (
              <li className={`expense-row${expense.amount === null && editingExpenseId === expense.id ? " editing-amount" : ""}`} key={expense.id}>
                <span className="expense-icon" aria-hidden="true">↗</span>
                <div className="expense-info">
                  <div className="expense-name">{expense.description}</div>
                  <div className="expense-date">
                    {expense.category} · {formatDate(expense.date)}
                    {isAccountId(expense.account) ? ` · ${accountName(expense.account)}` : ""}
                    {expense.recurringId ? " · Recurring" : ""}
                  </div>
                </div>
                <div className="expense-end">
                  {expense.amount === null ? (
                    editingExpenseId === expense.id ? (
                      <form className="inline-amount-form" aria-label={`Add amount for ${expense.description}`} onSubmit={(event) => saveMissingExpenseAmount(event, expense)}>
                        <input
                          className="inline-amount-input"
                          type="number"
                          min="0.01"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          aria-label="Amount"
                          required
                          autoFocus
                          value={editingAmount}
                          onChange={(event) => setEditingAmount(event.target.value)}
                        />
                        <button className="inline-save" type="submit">Save</button>
                        <button className="inline-cancel" type="button" onClick={() => { setEditingExpenseId(null); setEditingAmount(""); }}>Cancel</button>
                      </form>
                    ) : (
                      <>
                        <span className="missing-amount">No amount</span>
                        <button
                          className="add-amount-button"
                          type="button"
                          aria-label={`Add amount for ${expense.description}`}
                          onClick={() => { setEditingExpenseId(expense.id); setEditingAmount(""); }}
                        >Add amount</button>
                      </>
                    )
                  ) : (
                    <div className="expense-amounts">
                      <span className="expense-amount">{formatCurrency(expense.amount)}</span>
                      {conversionReady && (
                        <span className="converted-row">
                          ≈ {formatCurrency(Number(expense.amount) * conversionRate, targetCurrency)}
                        </span>
                      )}
                    </div>
                  )}
                  <button
                    className="remove"
                    type="button"
                    aria-label={`Remove ${expense.description}`}
                    title="Remove expense"
                    onClick={() => setExpenses((current) => current.filter((item) => item.id !== expense.id))}
                  >×</button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            {monthExpenses.length === 0
              ? `No expenses recorded in ${formatMonth(selectedMonth)}.`
              : "No expenses match your search and category filter."}
          </div>
        )}
      </section>

      <section className="panel backup-panel" aria-labelledby="backup-title">
        <h2 id="backup-title">Data backup</h2>
        <p className="currency-hint">
          Keep a copy outside this browser so you can restore it after clearing site data.
        </p>
        <div className="backup-actions">
          <button type="button" onClick={downloadBackup}>Download backup</button>
          <button
            className="backup-restore"
            type="button"
            onClick={() => backupFileInputRef.current?.click()}
          >
            Restore backup
          </button>
          <input
            ref={backupFileInputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="Choose a Spend backup file"
            onChange={restoreBackup}
          />
        </div>
        <p className="backup-status" role="status" aria-live="polite">{backupStatus}</p>
      </section>
    </main>
  );
}
