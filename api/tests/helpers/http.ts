import type { Express } from "express";
import request from "supertest";
import { unscopedDb } from "../../src/core/db/client.js";
import { bearer } from "./fixtures.js";

/** Tiny authenticated client: api(app, token).get("/brands"), .post(path, body) ... */
export function api(app: Express, token: string) {
  const base = "/api/v1";
  return {
    get: (path: string) => request(app).get(base + path).set(bearer(token)),
    post: (path: string, body: unknown = {}) => request(app).post(base + path).set(bearer(token)).send(body as object),
    put: (path: string, body: unknown = {}) => request(app).put(base + path).set(bearer(token)).send(body as object),
    patch: (path: string, body: unknown = {}) => request(app).patch(base + path).set(bearer(token)).send(body as object),
    del: (path: string) => request(app).delete(base + path).set(bearer(token)),
  };
}

/** Audit rows for an entity, oldest first (read directly; the API view is tested separately). */
export const auditFor = (tenantId: string, entityType: string, entityId: string) =>
  unscopedDb.auditLog.findMany({ where: { tenantId, entityType, entityId }, orderBy: { occurredAt: "asc" } });

export const randomUuid = () => crypto.randomUUID();
