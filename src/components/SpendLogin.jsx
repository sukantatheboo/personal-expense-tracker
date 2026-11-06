import { useCallback, useEffect, useRef, useState } from "react";
import "./SpendLogin.css";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
const busy = (s) => s === "checking" || s === "done";

const icon = {
  width: 30,
  height: 30,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};
const FaceIcon = () => (
  <svg {...icon}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 10v1.5M15 10v1.5M12 10v3.2h-1M9 15.8c1 .9 2 1.3 3 1.3s2-.4 3-1.3" />
  </svg>
);
const FingerprintIcon = () => (
  <svg {...icon}>
    <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
    <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
    <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    <path d="M2 12a10 10 0 0 1 18-6" />
    <path d="M2 16h.01" />
    <path d="M21.8 16c.2-2 .131-5.354 0-6" />
    <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
    <path d="M8.65 22c.21-.66.45-1.32.57-2" />
    <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
  </svg>
);

/**
 * Props
 *  verifyPin(pin)  -> boolean | {ok, message?} (or a Promise of either)   required: your PIN check; message shows on failure
 *  biometric       {type:"face"|"fingerprint", label} | null   from useBiometric(); null hides the button
 *  onBiometric()   -> Promise<boolean>             optional: resolve true on success
 *  autoPrompt                                      open the biometric prompt on mount (default false)
 *  onUnlock()                                      called ~450ms after success
 *  onForgot()                                      "Forgot PIN?" tapped
 *  pinLength                                       default 4
 */
export default function SpendLogin({
  verifyPin,
  biometric = { type: "face", label: "Face ID" },
  onBiometric,
  onUnlock,
  onForgot,
  autoPrompt = false,
  pinLength = 4,
}) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("idle"); // idle | checking | error | done
  const [msg, setMsg] = useState("");
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const finish = useCallback(() => {
    setStatus("done");
    setOpen(false);
    timer.current = setTimeout(() => onUnlock?.(), 450);
  }, [onUnlock]);

  const submit = useCallback(
    async (value) => {
      setStatus("checking");
      let res;
      try {
        res = await verifyPin(value);
      } catch {
        res = { ok: false, message: "Something went wrong. Try again." };
      }
      const ok = typeof res === "object" && res !== null ? res.ok : !!res;
      if (ok) finish();
      else {
        setMsg(res?.message || "Wrong PIN. Try again.");
        setStatus("error");
        setPin("");
      }
    },
    [verifyPin, finish]
  );

  const press = useCallback(
    (d) => {
      if (busy(status) || pin.length >= pinLength) return;
      const next = pin + d;
      setOpen(true);
      setStatus("idle");
      setPin(next);
      if (next.length === pinLength) submit(next);
    },
    [pin, pinLength, status, submit]
  );

  const back = useCallback(() => {
    if (busy(status)) return;
    setStatus("idle");
    setPin((p) => p.slice(0, -1));
  }, [status]);

  const bio = async () => {
    if (busy(status)) return;
    setOpen(false);
    try {
      if (await onBiometric?.()) finish();
    } catch {
      /* cancelled */
    }
  };

  const prompted = useRef(false);
  useEffect(() => {
    if (autoPrompt && biometric && !prompted.current) {
      prompted.current = true;
      bio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrompt, biometric]);

  // Physical keyboard: digits, Backspace, Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, back]);

  const cls = [
    "sl",
    open && "sl--open",
    status === "error" && "sl--error",
    status === "done" && "sl--done",
  ]
    .filter(Boolean)
    .join(" ");
  const done = status === "done";

  return (
    <main className={cls} aria-busy={status === "checking"}>
      <div className="sl__stack">
        <svg
          className="sl__logo"
          viewBox="0 0 64 64"
          role="img"
          aria-label="Spend"
        >
          <rect width="64" height="64" rx="16" fill="#39785d" />
          <path
            d="M22 43 43 22M28 22h15v15"
            fill="none"
            stroke="#fff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4.5"
          />
        </svg>
        <h1 className="sl__title">{done ? "Welcome back" : "Spend is locked"}</h1>
        <p className="sl__sub">
          {done
            ? "Opening your accounts…"
            : biometric
              ? `Enter your ${pinLength}-digit PIN or use ${biometric.label}.`
              : `Enter your ${pinLength}-digit PIN to access your accounts.`}
        </p>

        <div className="sl__row">
          <button
            type="button"
            className="sl__field"
            onClick={() => !done && setOpen(true)}
            aria-label="Enter your PIN"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="5" y="11" width="14" height="9" rx="2.5" />
              <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
            </svg>
            <span className="sl__dots">
              {Array.from({ length: pinLength }, (_, i) => (
                <span
                  key={i}
                  className={
                    "sl__dot" +
                    (pin.length > i || done ? " sl__dot--on" : "")
                  }
                />
              ))}
            </span>
          </button>
          {biometric && (
            <button
              type="button"
              className="sl__bio"
              onClick={bio}
              aria-label={`Unlock with ${biometric.label}`}
            >
              {biometric.type === "face" ? <FaceIcon /> : <FingerprintIcon />}
            </button>
          )}
        </div>

        <div className="sl__meta">
          {!done && (
            <button type="button" className="sl__link" onClick={onForgot}>
              Forgot PIN?
            </button>
          )}
          <p className="sl__error" role="alert">
            {status === "error" ? msg : ""}
          </p>
        </div>
      </div>

      <div className="sl__sheet" aria-hidden={!open}>
        <div className="sl__pad">
          {DIGITS.map((d) => (
            <button
              key={d}
              type="button"
              className="sl__key"
              onClick={() => press(d)}
              tabIndex={open ? 0 : -1}
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            className="sl__key sl__key--ghost"
            onClick={() => setOpen(false)}
            aria-label="Hide keypad"
            tabIndex={open ? 0 : -1}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            className="sl__key"
            onClick={() => press("0")}
            tabIndex={open ? 0 : -1}
          >
            0
          </button>
          <button
            type="button"
            className="sl__key sl__key--ghost"
            onClick={back}
            aria-label="Delete last digit"
            tabIndex={open ? 0 : -1}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z" />
              <path d="m12 9.5 5 5m0-5-5 5" />
            </svg>
          </button>
        </div>
      </div>
    </main>
  );
}
