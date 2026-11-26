import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

async function loadEdgeFunctionWithMocks(relPath, { env = {}, supabaseClient, webpushMock }) {
  const source = fs.readFileSync(path.join(ROOT, relPath), "utf8");
  const withoutImports = source
    .replace(/import\s+\{\s*createClient\s*\}\s+from\s+["']npm:@supabase\/supabase-js@2["'];\s*/g, "")
    .replace(/import\s+webpush\s+from\s+["']npm:web-push@3\.6\.7["'];\s*/g, "");
  const jsBody = stripTypeScriptTypes(withoutImports, { mode: "strip" });

  const globalKey = `__edgeMock_${Math.random().toString(36).slice(2)}`;
  let capturedHandler = null;
  globalThis[globalKey] = {
    createClient: () => supabaseClient,
    webpush: webpushMock,
    Deno: {
      env: {
        get: (k) => (Object.hasOwn(env, k) ? env[k] : undefined),
      },
      serve: (fn) => {
        capturedHandler = fn;
      },
    },
  };

  const wrapper = `
const { createClient, webpush, Deno } = globalThis[${JSON.stringify(globalKey)}];
${jsBody}
`;
  const tmpFile = path.join(
    os.tmpdir(),
    `spend-edge-${path.basename(path.dirname(relPath))}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`
  );
  fs.writeFileSync(tmpFile, wrapper, "utf8");
  try {
    await import(pathToFileURL(tmpFile).href);
    assert.equal(typeof capturedHandler, "function", `${relPath} must register Deno.serve handler`);
    return capturedHandler;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
    delete globalThis[globalKey];
  }
}

function makeChain(records, handler) {
  const ops = [];
  const builder = {
    select(cols) {
      ops.push(["select", cols]);
      return builder;
    },
    update(values) {
      ops.push(["update", values]);
      return builder;
    },
    delete() {
      ops.push(["delete"]);
      return builder;
    },
    eq(col, val) {
      ops.push(["eq", col, val]);
      return builder;
    },
    neq(col, val) {
      ops.push(["neq", col, val]);
      return builder;
    },
    in(col, vals) {
      ops.push(["in", col, vals]);
      return builder;
    },
    then(resolve, reject) {
      return Promise.resolve(handler(ops)).then(resolve, reject);
    },
  };
  return builder;
}

test("send-due-reminders Edge Function enforces cron secret, claim_until fencing, invalid-sub cleanup & PGRST202 fallback", async () => {
  const userId = "11111111-2222-4333-8444-555555555555";
  const devValid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const devGone = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
  const devBadSub = "aaaaaaaa-bbbb-4ccc-8ddd-999999999999";

  const nowMs = Date.now();
  const futureCheckIso = new Date(nowMs - 5 * 60 * 1000).toISOString();
  const staleIso = new Date(nowMs - 20 * 60 * 60 * 1000).toISOString();
  const todayStr = new Date(nowMs - 5 * 60 * 1000).toISOString().slice(0, 10);

  const dueRows = [
    {
      user_id: userId,
      device_id: devValid,
      schedule_id: "sched_rent",
      description: "Rent",
      interval: "monthly",
      day_of_month: Number(todayStr.slice(-2)),
      next_date: todayStr,
      next_notify_at: futureCheckIso,
      timezone: "UTC",
      reminder_time: "09:00",
      claim_until: "2026-11-25T05:00:00.000Z",
      subscription: {
        endpoint: "https://push.example/valid",
        keys: { p256dh: "pk1", auth: "au1" },
      },
    },
    {
      user_id: userId,
      device_id: devValid,
      schedule_id: "sched_stale",
      description: "Old Bill",
      interval: "weekly",
      day_of_month: Number(todayStr.slice(-2)),
      next_date: todayStr,
      next_notify_at: staleIso,
      timezone: "UTC",
      reminder_time: "09:00",
      claim_until: "2026-11-25T05:01:00.000Z",
      subscription: {
        endpoint: "https://push.example/valid",
        keys: { p256dh: "pk1", auth: "au1" },
      },
    },
    {
      user_id: userId,
      device_id: devBadSub,
      schedule_id: "sched_bad",
      description: "Malformed",
      interval: "monthly",
      day_of_month: 15,
      next_date: todayStr,
      next_notify_at: futureCheckIso,
      timezone: "UTC",
      reminder_time: "09:00",
      claim_until: "2026-11-25T05:02:00.000Z",
      subscription: { endpoint: "http://insecure.invalid" },
    },
    {
      user_id: userId,
      device_id: devGone,
      schedule_id: "sched_gone",
      description: "Expired Device",
      interval: "monthly",
      day_of_month: 15,
      next_date: todayStr,
      next_notify_at: futureCheckIso,
      timezone: "UTC",
      reminder_time: "09:00",
      claim_until: "2026-11-25T05:03:00.000Z",
      subscription: {
        endpoint: "https://push.example/gone",
        keys: { p256dh: "pk2", auth: "au2" },
      },
    },
  ];

  const dbOps = [];
  let rpcCount = 0;
  const mockSupabase = {
    async rpc(fnName, params) {
      dbOps.push({ kind: "rpc", fnName, params });
      if (fnName === "claim_due_push_reminders_with_devices") {
        rpcCount += 1;
        return { data: rpcCount === 1 ? dueRows : [], error: null };
      }
      return { data: [], error: null };
    },
    from(table) {
      return makeChain(dbOps, (ops) => {
        dbOps.push({ kind: "query", table, ops });
        return { data: [], error: null };
      });
    },
  };

  const sentNotifications = [];
  let vapidSubjectSeen = "";
  const mockWebpush = {
    setVapidDetails(subject) {
      vapidSubjectSeen = subject;
    },
    async sendNotification(sub, payload) {
      sentNotifications.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      if (sub.endpoint.endsWith("/gone")) {
        const err = new Error("Gone");
        err.statusCode = 410;
        throw err;
      }
    },
  };

  const handler = await loadEdgeFunctionWithMocks(
    "supabase/functions/send-due-reminders/index.ts",
    {
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        VAPID_SUBJECT: "mailto:ops@spend.example",
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        CRON_SECRET: "  top-secret-123  ",
      },
      supabaseClient: mockSupabase,
      webpushMock: mockWebpush,
    }
  );

  assert.equal(vapidSubjectSeen, "mailto:ops@spend.example");

  const getRes = await handler(new Request("https://fn.local", { method: "GET" }));
  assert.equal(getRes.status, 405);

  const badSecretRes = await handler(
    new Request("https://fn.local", { method: "POST", headers: { "x-cron-secret": "wrong" } })
  );
  assert.equal(badSecretRes.status, 403);

  const okRes = await handler(
    new Request("https://fn.local", { method: "POST", headers: { "x-cron-secret": "top-secret-123" } })
  );
  assert.equal(okRes.status, 200);
  const summary = await okRes.json();
  assert.equal(summary.due, 4);
  assert.equal(summary.sent, 1);
  assert.equal(summary.batches, 1);

  assert.equal(sentNotifications.length, 2); // valid + 410-attempt (stale & invalid skipped)
  assert.equal(sentNotifications[0].endpoint, "https://push.example/valid");

  const rentUpdate = dbOps.find(
    (op) =>
      op.kind === "query" &&
      op.table === "push_reminders" &&
      op.ops.some((x) => x[0] === "update") &&
      op.ops.some((x) => x[0] === "eq" && x[1] === "schedule_id" && x[2] === "sched_rent")
  );
  assert.ok(rentUpdate, "Must advance sched_rent after send");
  assert.ok(
    rentUpdate.ops.some((x) => x[0] === "eq" && x[1] === "claim_until" && x[2] === "2026-11-25T05:00:00.000Z"),
    "Must fence post-send update with claim_until"
  );

  const staleUpdate = dbOps.find(
    (op) =>
      op.kind === "query" &&
      op.table === "push_reminders" &&
      op.ops.some((x) => x[0] === "update") &&
      op.ops.some((x) => x[0] === "eq" && x[1] === "schedule_id" && x[2] === "sched_stale")
  );
  assert.ok(staleUpdate, "Must still advance stale reminder forward");
  assert.ok(
    staleUpdate.ops.some((x) => x[0] === "eq" && x[1] === "claim_until" && x[2] === "2026-11-25T05:01:00.000Z"),
    "Must fence stale advance with claim_until"
  );

  const deletedBadDev = dbOps.find(
    (op) =>
      op.kind === "query" &&
      op.table === "push_devices" &&
      op.ops.some((x) => x[0] === "delete") &&
      op.ops.some((x) => x[0] === "eq" && x[1] === "device_id" && x[2] === devBadSub)
  );
  assert.ok(deletedBadDev, "Must prune malformed push_devices entry");

  const deletedGoneDev = dbOps.find(
    (op) =>
      op.kind === "query" &&
      op.table === "push_devices" &&
      op.ops.some((x) => x[0] === "delete") &&
      op.ops.some((x) => x[0] === "eq" && x[1] === "device_id" && x[2] === devGone)
  );
  assert.ok(deletedGoneDev, "Must prune 410 Gone push_devices entry");

  // Also test PGRST202 fallback path to claim_due_push_reminders + chunked push_devices query
  let fallbackUsed = false;
  let chunkedDeviceLookupUsed = false;
  const fallbackClient = {
    async rpc(fnName) {
      if (fnName === "claim_due_push_reminders_with_devices") {
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      }
      fallbackUsed = true;
      return {
        data: [
          {
            user_id: userId,
            device_id: devValid,
            schedule_id: "sched_fb",
            description: "Water",
            interval: "monthly",
            day_of_month: Number(todayStr.slice(-2)),
            next_date: todayStr,
            next_notify_at: futureCheckIso,
            timezone: "UTC",
            reminder_time: "09:00",
            claim_until: "2026-11-25T05:05:00.000Z",
          },
        ],
        error: null,
      };
    },
    from(table) {
      return makeChain(dbOps, (ops) => {
        if (table === "push_devices" && ops.some((x) => x[0] === "select")) {
          chunkedDeviceLookupUsed = true;
          return {
            data: [
              {
                user_id: userId,
                device_id: devValid,
                subscription: { endpoint: "https://push.example/valid", keys: { p256dh: "pk1", auth: "au1" } },
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      });
    },
  };
  const fallbackHandler = await loadEdgeFunctionWithMocks(
    "supabase/functions/send-due-reminders/index.ts",
    {
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        VAPID_SUBJECT: "mailto:ops@spend.example",
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        CRON_SECRET: "top-secret-123",
      },
      supabaseClient: fallbackClient,
      webpushMock: mockWebpush,
    }
  );
  const fbRes = await fallbackHandler(
    new Request("https://fn.local", { method: "POST", headers: { "x-cron-secret": "top-secret-123" } })
  );
  assert.equal(fbRes.status, 200);
  const fbJson = await fbRes.json();
  assert.equal(fbJson.sent, 1);
  assert.equal(fallbackUsed, true);
  assert.equal(chunkedDeviceLookupUsed, true);
});

test("send-activity-push Edge Function enforces CORS, JWT auth, UUID excludeDeviceId & subscription validation", async () => {
  const userId = "11111111-2222-4333-8444-555555555555";
  const selfDev = "aaaaaaaa-1111-4111-8111-111111111111";
  const peerDev = "bbbbbbbb-2222-4222-8222-222222222222";
  const badDev = "cccccccc-3333-4333-8333-333333333333";

  let lastNeqFilter = null;
  const mockSupabase = {
    auth: {
      async getUser(token) {
        if (token === "valid-jwt") {
          return { data: { user: { id: userId } }, error: null };
        }
        return { data: { user: null }, error: { message: "bad jwt" } };
      },
    },
    from(table) {
      return makeChain([], (ops) => {
        if (table === "push_devices" && ops.some((x) => x[0] === "select")) {
          const neq = ops.find((x) => x[0] === "neq");
          lastNeqFilter = neq ? neq[2] : null;
          return {
            data: [
              { device_id: peerDev, subscription: { endpoint: "https://push.example/peer", keys: { p256dh: "p", auth: "a" } } },
              { device_id: badDev, subscription: { endpoint: "http://not-https" } },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      });
    },
  };

  const sent = [];
  const mockWebpush = {
    setVapidDetails() {},
    async sendNotification(sub, payload) {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  };

  const handler = await loadEdgeFunctionWithMocks(
    "supabase/functions/send-activity-push/index.ts",
    {
      env: {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
        VAPID_SUBJECT: "mailto:ops@spend.example",
        VAPID_PUBLIC_KEY: "pub",
        VAPID_PRIVATE_KEY: "priv",
        ALLOWED_ORIGIN: "https://app.spend.example, https://staging.spend.example",
      },
      supabaseClient: mockSupabase,
      webpushMock: mockWebpush,
    }
  );

  const preflight = await handler(
    new Request("https://fn.local", {
      method: "OPTIONS",
      headers: { origin: "https://staging.spend.example" },
    })
  );
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "https://staging.spend.example");

  const unauth = await handler(new Request("https://fn.local", { method: "POST", body: "{}" }));
  assert.equal(unauth.status, 401);

  const badJwt = await handler(
    new Request("https://fn.local", {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: JSON.stringify({ title: "x", body: "y" }),
    })
  );
  assert.equal(badJwt.status, 401);

  const ok = await handler(
    new Request("https://fn.local", {
      method: "POST",
      headers: {
        authorization: "Bearer valid-jwt",
        origin: "https://evil.example",
      },
      body: JSON.stringify({
        title: "Coffee logged",
        body: "৳250 on bKash",
        tab: "activity",
        excludeDeviceId: selfDev,
      }),
    })
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://app.spend.example");
  assert.equal(lastNeqFilter, selfDev);
  const resJson = await ok.json();
  assert.equal(resJson.sent, 1);
  assert.equal(resJson.devices, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.tab, "activity");

  // Non-UUID excludeDeviceId must be ignored
  lastNeqFilter = null;
  await handler(
    new Request("https://fn.local", {
      method: "POST",
      headers: { authorization: "Bearer valid-jwt" },
      body: JSON.stringify({
        title: "Lunch",
        body: "৳300",
        excludeDeviceId: "invalid-id;drop",
      }),
    })
  );
  assert.equal(lastNeqFilter, null);
});
