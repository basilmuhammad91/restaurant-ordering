// These mirror what the API actually returns (see api/prisma/schema.prisma and api/src/routes/*).
// Dates arrive as ISO strings because JSON has no Date type.
// All money is integer minor units (paisa): 125000 = Rs. 1,250.

export type Role = "CUSTOMER" | "ADMIN";

export type OrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
export type OrderChannel = "WEB" | "POS" | "ANDROID" | "IOS";

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
  imageUrl: string | null;
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
  imageUrl: string | null;
  available: boolean;
  categoryId: number;
}

export interface DealItem {
  id: number;
  menuItemId: number;
  quantity: number;
  menuItem: { id: number; name: string; imageUrl: string | null; available: boolean; priceCents: number };
}

export interface Deal {
  id: number;
  name: string;
  description: string | null;
  imageUrl: string | null;
  dealPriceCents: number;
  originalPriceCents: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  items: DealItem[];
  available: boolean; // false while any part of the deal is sold out
}

export interface DealInput {
  name: string;
  description: string | null;
  imageUrl: string | null;
  dealPriceCents: number;
  originalPriceCents?: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  items: { menuItemId: number; quantity: number }[];
}

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemId: number;
  quantity: number;
  unitPriceCents: number;
  menuItem: { id: number; name: string };
}

export interface OrderDeal {
  id: number;
  orderId: number;
  dealId: number;
  dealName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: number;
  userId: number;
  status: OrderStatus;
  channel: OrderChannel;
  totalCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: number; name: string; email: string };
  items: OrderItem[];
  deals: OrderDeal[];
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface Stats {
  range: { from: string; to: string; timezone: string };
  statuses: Record<OrderStatus, { count: number; amountCents: number }>;
  kpis: { totalOrders: number; totalSalesCents: number; averageOrderValueCents: number; cancelledRate: number };
  channels: { channel: OrderChannel; count: number }[];
  daily: { date: string; orders: number; salesCents: number }[];
  topItems: { menuItemId: number; name: string; quantity: number }[];
}
