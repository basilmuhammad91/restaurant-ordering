import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

// Supertest = Laravel's $this->getJson(). Vitest = PHPUnit/Pest.
describe("health", () => {
  const app = createApp();

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("unknown routes return a JSON 404", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});
