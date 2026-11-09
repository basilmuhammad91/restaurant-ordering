import type { Severity } from "@restoflux/contracts";
import type { Db } from "../db/scoped.js";

export type NotifyClient = { notification: Db["notification"] };

export interface NotifyInput {
  /** Free-form key: LOW_STOCK, APPROVAL_PENDING, CASH_SHORTAGE ... (new types need no migration). */
  type: string;
  severity?: Severity;
  title: string;
  body?: string;
  /** A specific recipient, or leave empty and set requiredPermission to reach everyone who holds it in scope. */
  userId?: string | null;
  requiredPermission?: string | null;
  locationId?: string | null;
  entityType?: string;
  entityId?: string;
  /** One notification per key: repeating the same alert does not create a storm. */
  dedupeKey: string;
}

/** Create a notification unless one with the same dedupeKey already exists. */
export async function notify(client: NotifyClient, input: NotifyInput): Promise<void> {
  await client.notification.createMany({
    data: [
      {
        tenantId: "", // stamped by the scoped client
        type: input.type,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body ?? null,
        userId: input.userId ?? null,
        requiredPermission: input.requiredPermission ?? null,
        locationId: input.locationId ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey,
      },
    ],
    skipDuplicates: true,
  });
}
