import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { get } from '../database';
import { ApiError } from '../utils/response';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    username: string;
    role: string;
    realName?: string;
  };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new ApiError(401, '未提供认证令牌', 'unauthorized');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;

    const user = await get(
      'SELECT id, username, real_name, role, status FROM users WHERE id = ?',
      [decoded.userId]
    );

    if (!user) {
      throw new ApiError(401, '用户不存在', 'unauthorized');
    }

    if (user.status !== 1) {
      throw new ApiError(403, '账号已被禁用', 'forbidden');
    }

    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      realName: user.real_name
    };

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
    } else {
      next(new ApiError(401, '认证失败', 'unauthorized'));
    }
  }
};

export const roleMiddleware = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new ApiError(401, '未认证', 'unauthorized');
    }

    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, '权限不足', 'forbidden');
    }

    next();
  };
};

export const adminAuth = [authMiddleware, roleMiddleware('admin')];
export const staffAuth = [authMiddleware, roleMiddleware('admin', 'staff')];
export const userAuth = authMiddleware;
