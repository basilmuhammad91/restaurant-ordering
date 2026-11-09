// These mirror what the API actually returns (see api/prisma/schema.prisma and api/src/routes/*).
// Dates arrive as ISO strings because JSON has no Date type.

export type Role = "CUSTOMER" | "ADMIN";

export type OrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  createdAt?: string;
}

export interface Category {
  id: number;
  name: string;
}

export interface MenuItem {
  id: number;
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
  categoryId: number;
  category: { id: number; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface MenuItemInput {
  name: string;
  description: string | null;
  priceCents: number;
  available: boolean;
  categoryId: number;
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  quantity: number;
  unitPriceCents: number;
  menuItem: { id: number; name: string };
}

export interface Order {
  id: number;
  userId: number;
  status: OrderStatus;
  totalCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: number; name: string; email: string };
  items: OrderItem[];
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface AuthResponse {
  user: User;
  token: string;
}
