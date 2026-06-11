import { Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateMemberNo } from '../utils/generator';
import { sendMessage } from '../services/message.service';
import dayjs from 'dayjs';

export const getMemberInfo = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const member = await get(
    `SELECT m.*, u.username, u.real_name, u.phone, u.avatar, u.id_card
     FROM members m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.user_id = ?`,
    [userId]
  );

  if (!member) {
    throw new ApiError(404, '会员信息不存在', 'not_found');
  }

  successResponse(res, member);
});

export const getMemberInfoByUserId = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id } = req.params;

  const member = await get(
    `SELECT m.*, u.username, u.real_name, u.phone, u.avatar, u.id_card
     FROM members m
     LEFT JOIN users u ON m.user_id = u.id
     WHERE m.user_id = ?`,
    [user_id]
  );

  if (!member) {
    throw new ApiError(404, '会员信息不存在', 'not_found');
  }

  successResponse(res, member);
});

export const createMember = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const existingMember = await get('SELECT id FROM members WHERE user_id = ?', [userId]);
  if (existingMember) {
    throw new ApiError(400, '您已经是会员了', 'already_member');
  }

  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new ApiError(404, '用户不存在', 'not_found');
  }

  const memberNo = generateMemberNo();
  const expireDate = dayjs().add(1, 'year').format('YYYY-MM-DD HH:mm:ss');

  const memberId = await run(
    `INSERT INTO members (user_id, member_no, member_level, points, total_points, expire_date) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, memberNo, 'normal', 100, 100, expireDate]
  );

  await run(
    `INSERT INTO point_records (member_id, user_id, points, type, reason) 
     VALUES (?, ?, ?, ?, ?)`,
    [memberId, userId, 100, 'reward', '注册赠送积分']
  );

  await sendMessage(
    userId,
    '会员注册成功',
    `恭喜您成为数字文化馆会员！会员编号：${memberNo}。已赠送100积分。`,
    'system',
    memberId,
    'member'
  );

  const member = await get('SELECT * FROM members WHERE id = ?', [memberId]);
  successResponse(res, member, '会员注册成功');
});

export const updateMemberProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { real_name, phone, id_card, avatar } = req.body;

  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new ApiError(404, '用户不存在', 'not_found');
  }

  await run(
    `UPDATE users SET real_name = ?, phone = ?, id_card = ?, avatar = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [
      real_name !== undefined ? real_name : user.real_name,
      phone !== undefined ? phone : user.phone,
      id_card !== undefined ? id_card : user.id_card,
      avatar !== undefined ? avatar : user.avatar,
      userId
    ]
  );

  const updatedUser = await get(
    `SELECT u.*, m.member_no, m.member_level, m.points, m.join_date 
     FROM users u
     LEFT JOIN members m ON u.id = m.user_id
     WHERE u.id = ?`,
    [userId]
  );

  successResponse(res, updatedUser, '资料更新成功');
});

export const getPointRecords = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { type, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = 'SELECT * FROM point_records WHERE user_id = ?';
  let params: any[] = [userId];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const addPoints = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, points, reason, related_id, related_type } = req.body;

  if (!user_id || !points || points <= 0) {
    throw new ApiError(400, '参数错误', 'invalid_params');
  }

  const member = await get('SELECT * FROM members WHERE user_id = ?', [user_id]);
  if (!member) {
    throw new ApiError(404, '会员不存在', 'not_found');
  }

  if (member.status !== 1) {
    throw new ApiError(400, '会员状态异常', 'invalid_operation');
  }

  await run(
    'UPDATE members SET points = points + ?, total_points = total_points + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    [points, points, user_id]
  );

  await run(
    `INSERT INTO point_records (member_id, user_id, points, type, reason, related_id, related_type) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, user_id, points, 'reward', reason || '积分发放', related_id || null, related_type || null]
  );

  await sendMessage(
    user_id,
    '积分到账提醒',
    `恭喜您获得${points}积分！${reason || ''}`,
    'system',
    related_id || null,
    related_type || 'points'
  );

  const updated = await get('SELECT * FROM members WHERE user_id = ?', [user_id]);
  successResponse(res, updated, '积分发放成功');
});

export const deductPoints = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { points, reason, related_id, related_type } = req.body;

  if (!points || points <= 0) {
    throw new ApiError(400, '积分数量无效', 'invalid_params');
  }

  const member = await get('SELECT * FROM members WHERE user_id = ?', [userId]);
  if (!member) {
    throw new ApiError(404, '会员不存在', 'not_found');
  }

  if (member.points < points) {
    throw new ApiError(400, '积分不足', 'points_insufficient');
  }

  await run(
    'UPDATE members SET points = points - ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
    [points, userId]
  );

  await run(
    `INSERT INTO point_records (member_id, user_id, points, type, reason, related_id, related_type) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, userId, -points, 'deduct', reason || '积分消耗', related_id || null, related_type || null]
  );

  const updated = await get('SELECT * FROM members WHERE user_id = ?', [userId]);
  successResponse(res, updated, '积分扣减成功');
});

export const getMemberList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { keyword, level, status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT m.*, u.username, u.real_name, u.phone, u.id_card, u.avatar
             FROM members m
             LEFT JOIN users u ON m.user_id = u.id
             WHERE 1=1`;
  let params: any[] = [];

  if (keyword) {
    sql += ' AND (u.real_name LIKE ? OR u.phone LIKE ? OR m.member_no LIKE ?)';
    const keywordLike = `%${keyword}%`;
    params.push(keywordLike, keywordLike, keywordLike);
  }
  if (level) {
    sql += ' AND m.member_level = ?';
    params.push(level);
  }
  if (status !== undefined) {
    sql += ' AND m.status = ?';
    params.push(status);
  }

  const countSql = sql.replace(
    'SELECT m.*, u.username, u.real_name, u.phone, u.id_card, u.avatar',
    'SELECT COUNT(*) as count'
  );
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY m.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const updateMemberLevel = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { level } = req.body;

  if (!level || !['normal', 'silver', 'gold', 'platinum'].includes(level)) {
    throw new ApiError(400, '会员等级无效', 'invalid_params');
  }

  const member = await get('SELECT * FROM members WHERE id = ?', [id]);
  if (!member) {
    throw new ApiError(404, '会员不存在', 'not_found');
  }

  await run(
    'UPDATE members SET member_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [level, id]
  );

  const updated = await get('SELECT * FROM members WHERE id = ?', [id]);

  const levelNames: Record<string, string> = {
    normal: '普通会员',
    silver: '白银会员',
    gold: '黄金会员',
    platinum: '铂金会员'
  };

  await sendMessage(
    member.user_id,
    '会员等级变更',
    `您的会员等级已变更为：${levelNames[level] || level}`,
    'system',
    Number(id),
    'member'
  );

  successResponse(res, updated, '等级更新成功');
});

export const getMessageList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { type, is_read, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = 'SELECT * FROM messages WHERE user_id = ?';
  let params: any[] = [userId];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  if (is_read !== undefined) {
    sql += ' AND is_read = ?';
    params.push(is_read);
  }

  const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getUnreadCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const result = await get(
    'SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND is_read = 0',
    [userId]
  );

  successResponse(res, { unread_count: result?.count || 0 });
});

export const markMessageRead = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  await run(
    'UPDATE messages SET is_read = 1, read_time = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
    [id, userId]
  );

  successResponse(res, null, '标记成功');
});

export const markAllMessagesRead = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  await run(
    'UPDATE messages SET is_read = 1, read_time = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0',
    [userId]
  );

  successResponse(res, null, '全部标记成功');
});
