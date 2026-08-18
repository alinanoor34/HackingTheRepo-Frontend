import { beforeEach, describe, expect, it, vi } from "vitest";
import api, { USER_KEY, clearSession } from "../utils/api";

vi.mock("../utils/metrics", () => ({
  sendMetricEvent: vi.fn(),
}));

describe("api interceptor", () => {
  beforeEach(() => {
    clearSession();
    localStorage.clear();
  });

  it("sends the httpOnly session cookie with every request", () => {
    expect(api.defaults.withCredentials).toBe(true);
  });

  it("does not attach a manual Authorization header (session is cookie-based)", async () => {
    const handlers = api.interceptors.request as unknown as {
      handlers: Array<{ fulfilled?: (config: Record<string, unknown>) => Record<string, unknown> }>;
    };
    const requestHandler = handlers.handlers.find((h) => h.fulfilled)?.fulfilled;
    expect(requestHandler).toBeTruthy();

    const config = await requestHandler!({
      headers: {},
      url: "/jobs",
      method: "get",
    });

    expect((config.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("clears cached user on 401 response", async () => {
    localStorage.setItem(USER_KEY, JSON.stringify({ id: "1" }));

    const handlers = api.interceptors.response as unknown as {
      handlers: Array<{
        rejected?: (error: unknown) => Promise<unknown>;
      }>;
    };
    const rejectHandler = handlers.handlers.find((h) => h.rejected)?.rejected;
    expect(rejectHandler).toBeTruthy();

    await expect(
      rejectHandler!({
        response: { status: 401 },
        config: { url: "/auth/me", method: "get", headers: {} },
      }),
    ).rejects.toBeTruthy();

    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });
});