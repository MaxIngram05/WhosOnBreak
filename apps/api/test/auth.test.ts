import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("signing in", () => {
  it("creates an account once and recognises it after that", async () => {
    const first = await h.request("POST", "/v1/auth/google", { body: { idToken: "test:repeat" } });
    const second = await h.request("POST", "/v1/auth/google", { body: { idToken: "test:repeat" } });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it("gives every new account a friend code", async () => {
    const user = await h.signIn("coded");
    expect(user.friendCode).toMatch(/^[23456789A-HJKMNP-Z]{8}$/);
  });

  it("starts a first-time user on an empty schedule in their own zone", async () => {
    const user = await h.signIn("zoned", "Europe/London");
    const schedules = await h.request("GET", "/v1/schedules", { token: user.token });

    expect(schedules.body).toHaveLength(1);
    expect(schedules.body[0]).toMatchObject({ timeZone: "Europe/London", isActive: true });
  });

  it("rejects a token the verifier does not accept", async () => {
    const response = await h.request("POST", "/v1/auth/google", { body: { idToken: "forged" } });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthenticated");
  });
});

describe("protected routes", () => {
  it("need a bearer token", async () => {
    const response = await h.request("GET", "/v1/me");
    expect(response.status).toBe(401);
  });

  it("refuse a token signed with someone else's key", async () => {
    const user = await h.signIn();
    const [header, payload] = user.token.split(".");
    const response = await h.request("GET", "/v1/me", { token: `${header}.${payload}.AAAA` });
    expect(response.status).toBe(401);
  });
});

describe("refresh tokens", () => {
  it("rotate: each one works exactly once and yields a new one", async () => {
    const user = await h.signIn();

    const refreshed = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: user.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(user.refreshToken);

    const me = await h.request("GET", "/v1/me", { token: refreshed.body.accessToken });
    expect(me.body.id).toBe(user.id);
  });

  it("kill the whole session when a used one comes back", async () => {
    const user = await h.signIn();

    const legitimate = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: user.refreshToken },
    });

    // Someone replays the original. It fails...
    const replay = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: user.refreshToken },
    });
    expect(replay.status).toBe(401);

    // ...and so does the token the rightful owner was just given.
    const owner = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: legitimate.body.refreshToken },
    });
    expect(owner.status).toBe(401);
  });
});

describe("logging out", () => {
  it("ends this device's session without needing the refresh token", async () => {
    const user = await h.signIn();

    const logout = await h.request("POST", "/v1/auth/logout", { token: user.token, body: {} });
    expect(logout.status).toBe(204);

    const refresh = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: user.refreshToken },
    });
    expect(refresh.status).toBe(401);
  });

  it("leaves other devices signed in unless asked to end them all", async () => {
    const phone = await h.request("POST", "/v1/auth/google", { body: { idToken: "test:two-devices" } });
    const tablet = await h.request("POST", "/v1/auth/google", { body: { idToken: "test:two-devices" } });

    await h.request("POST", "/v1/auth/logout", { token: phone.body.accessToken, body: {} });
    const tabletRefresh = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: tablet.body.refreshToken },
    });
    expect(tabletRefresh.status).toBe(200);

    await h.request("POST", "/v1/auth/logout", {
      token: tabletRefresh.body.accessToken,
      body: { allDevices: true },
    });
    const afterAll = await h.request("POST", "/v1/auth/refresh", {
      body: { refreshToken: tabletRefresh.body.refreshToken },
    });
    expect(afterAll.status).toBe(401);
  });
});

describe("rate limiting", () => {
  it("turns away a burst of sign-ins from one address", async () => {
    const limited = await createHarness({ rateLimits: true });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const response = await limited.request("POST", "/v1/auth/google", {
          body: { idToken: `test:burst-${i}` },
          headers: { "cf-connecting-ip": "203.0.113.9" },
        });
        statuses.push(response.status);
      }
      expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe("errors", () => {
  it("share one shape, including for unknown routes", async () => {
    const user = await h.signIn();
    const response = await h.request("GET", "/v1/does-not-exist", { token: user.token });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: "not_found", message: expect.any(String) } });
  });

  it("list every invalid field at once", async () => {
    const user = await h.signIn();
    const response = await h.request("POST", "/v1/schedules", {
      token: user.token,
      body: { name: "", timeZone: "Mars/Olympus" },
    });
    expect(response.status).toBe(400);
    expect(Object.keys(response.body.error.fields)).toEqual(
      expect.arrayContaining(["name", "timeZone"]),
    );
  });
});
