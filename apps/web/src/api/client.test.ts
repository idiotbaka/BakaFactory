import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("OpenAPI health client", () => {
  it("fetches /health and accepts ready responses", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          database: "ok",
          version: "0.1.0",
          environment: "local",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const { getHealth } = await import("./client");
    await expect(getHealth()).resolves.toHaveProperty("database", "ok");
    expect((fetch.mock.calls[0][0] as Request).url).toMatch(/\/health$/);
  });
  it("preserves the request ID from an API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "database_unavailable",
              message: "Database is unavailable",
              request_id: "trace-1",
            },
          }),
          { status: 503 },
        ),
      ),
    );
    const { getHealth } = await import("./client");
    await expect(getHealth()).rejects.toThrow("trace-1");
  });
  it("rejects malformed success responses instead of reporting Online", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }))),
    );
    const { getHealth } = await import("./client");
    await expect(getHealth()).rejects.toThrow("无效");
  });
});
