import { run, get, all } from '../database';

export const sendMessage = async (
  userId: number,
  title: string,
  content: string,
  type: string = 'system',
  relatedId?: number,
  relatedType?: string
): Promise<number> => {
  const id = await run(
    `INSERT INTO messages (user_id, title, content, type, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, title, content, type, relatedId || null, relatedType || null]
  );
  return id;
};

export const getMessageList = async (
  userId: number,
  page: number = 1,
  pageSize: number = 20,
  isRead?: number
): Promise<{ list: any[]; total: number }> => {
  const offset = (page - 1) * pageSize;
  let whereSql = 'WHERE user_id = ?';
  let params: any[] = [userId];

  if (isRead !== undefined) {
    whereSql += ' AND is_read = ?';
    params.push(isRead);
  }

  const list = await all(
    `SELECT * FROM messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  const totalResult = await get(
    `SELECT COUNT(*) as count FROM messages ${whereSql}`,
    params
  );

  return {
    list,
    total: totalResult?.count || 0
  };
};

export const markAsRead = async (messageId: number, userId: number): Promise<void> => {
  await run(
    `UPDATE messages SET is_read = 1, read_time = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
    [messageId, userId]
  );
};

export const markAllAsRead = async (userId: number): Promise<void> => {
  await run(
    `UPDATE messages SET is_read = 1, read_time = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
};

export const getUnreadCount = async (userId: number): Promise<number> => {
  const result = await get(
    `SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND is_read = 0`,
    [userId]
  );
  return result?.count || 0;
};
