import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { sendMessage } from '../services/message.service';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { username, password, real_name, phone, id_card } = req.body;

  if (!username || !password) {
    throw new ApiError(400, '用户名和密码为必填项', 'invalid_params');
  }

  if (password.length < 6) {
    throw new ApiError(400, '密码长度不能少于6位', 'invalid_params');
  }

  const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUser) {
    throw new ApiError(400, '用户名已存在', 'username_exists');
  }

  if (phone) {
    const phoneExists = await get('SELECT id FROM users WHERE phone = ?', [phone]);
    if (phoneExists) {
      throw new ApiError(400, '手机号已注册', 'phone_exists');
    }
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const userId = await run(
    `INSERT INTO users (username, password, real_name, phone, id_card, role) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    [username, hashedPassword, real_name || '', phone || '', id_card || '', 'user']
  );

  const user = await get(
    'SELECT id, username, real_name, phone, role, avatar, status, created_at FROM users WHERE id = ?',
    [userId]
  );

  const token = generateToken(userId as number, username, user?.role || 'user');

  successResponse(res, {
    user,
    token
  }, '注册成功');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { username, password, source = 'web' } = req.body;

  if (!username || !password) {
    throw new ApiError(400, '用户名和密码为必填项', 'invalid_params');
  }

  const user = await get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    throw new ApiError(401, '用户名或密码错误', 'invalid_credentials');
  }

  const isValidPassword = await bcrypt.compare(password, user.password);
  if (!isValidPassword) {
    throw new ApiError(401, '用户名或密码错误', 'invalid_credentials');
  }

  if (user.status !== 1) {
    throw new ApiError(403, '账号已被禁用', 'account_disabled');
  }

  const token = generateToken(user.id, user.username, user.role);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await run(
    `INSERT INTO access_tokens (user_id, token, source, expires_at) VALUES (?, ?, ?, ?)`,
    [user.id, token, source, expiresAt.toISOString()]
  );

  const userInfo = {
    id: user.id,
    username: user.username,
    real_name: user.real_name,
    phone: user.phone,
    role: user.role,
    avatar: user.avatar,
    status: user.status
  };

  await sendMessage(
    user.id,
    '登录提醒',
    `您的账号于${new Date().toLocaleString()}通过${source}登录。如非本人操作请及时修改密码。`,
    'system'
  );

  successResponse(res, {
    user: userInfo,
    token
  }, '登录成功');
});

export const logout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (token) {
    await run('DELETE FROM access_tokens WHERE token = ?', [token]);
  }

  successResponse(res, null, '退出成功');
});

export const getCurrentUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const user = await get(
    `SELECT u.*, m.member_no, m.member_level, m.points, m.total_points, m.join_date, m.expire_date, m.status as member_status
     FROM users u
     LEFT JOIN members m ON u.id = m.user_id
     WHERE u.id = ?`,
    [userId]
  );

  if (!user) {
    throw new ApiError(404, '用户不存在', 'not_found');
  }

  const { password, ...userWithoutPassword } = user;
  successResponse(res, userWithoutPassword);
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { old_password, new_password } = req.body;

  if (!old_password || !new_password) {
    throw new ApiError(400, '旧密码和新密码为必填项', 'invalid_params');
  }

  if (new_password.length < 6) {
    throw new ApiError(400, '新密码长度不能少于6位', 'invalid_params');
  }

  const user = await get('SELECT password FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new ApiError(404, '用户不存在', 'not_found');
  }

  const isValidPassword = await bcrypt.compare(old_password, user.password);
  if (!isValidPassword) {
    throw new ApiError(400, '旧密码错误', 'wrong_password');
  }

  const hashedPassword = await bcrypt.hash(new_password, 10);

  await run(
    'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [hashedPassword, userId]
  );

  await run('DELETE FROM access_tokens WHERE user_id = ?', [userId]);

  await sendMessage(
    userId,
    '密码修改成功',
    '您的账号密码已成功修改。如非本人操作请及时联系客服。',
    'system'
  );

  successResponse(res, null, '密码修改成功');
});

const generateToken = (userId: number, username: string, role: string): string => {
  return jwt.sign(
    { userId, username, role },
    process.env.JWT_SECRET || 'secret',
    { expiresIn: (process.env.TOKEN_EXPIRES_IN || '7d') as any }
  );
};

export const updateProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { real_name, phone, id_card, avatar } = req.body;

  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    throw new ApiError(404, '用户不存在', 'not_found');
  }

  if (phone && phone !== user.phone) {
    const phoneExists = await get('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, userId]);
    if (phoneExists) {
      throw new ApiError(400, '手机号已被使用', 'phone_exists');
    }
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

  const updated = await get(
    'SELECT id, username, real_name, phone, id_card, role, avatar, status, created_at FROM users WHERE id = ?',
    [userId]
  );

  successResponse(res, updated, '资料更新成功');
});
