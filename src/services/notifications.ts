import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type SystemNotification = {
  id: number;
  recipientRole: string;
  recipientName: string | null;
  channel: string;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: number | null;
  isRead: boolean;
  createdAt: string | null;
  readAt: string | null;
  relativeTime: string;
};

export type NotificationPayload = {
  items: SystemNotification[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    unreadCount: number;
    totalUnread: number;
  };
};

export async function fetchNotifications(filter = 'all'): Promise<NotificationPayload> {
  const params = new URLSearchParams();
  if (filter.trim()) params.set('filter', filter.trim().toLowerCase());
  return await fetchApiData<NotificationPayload>(`/api/notifications?${params.toString()}`, { ttlMs: 8_000 });
}

export async function markNotificationRead(notificationId: number): Promise<{ unreadCount: number }> {
  const data = await fetchApiData<{ unreadCount: number }>(`/api/notifications/${notificationId}/read`, {
    method: 'PATCH'
  });
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/dashboard/alerts');
  return data;
}

export async function markAllNotificationsRead(): Promise<{ unreadCount: number }> {
  const data = await fetchApiData<{ unreadCount: number }>('/api/notifications/read-all', {
    method: 'PATCH'
  });
  invalidateApiCache('/api/notifications');
  invalidateApiCache('/api/dashboard/alerts');
  return data;
}
