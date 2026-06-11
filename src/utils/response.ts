import { Request, Response, NextFunction } from 'express';

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, message: string, code: string = 'error') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const successResponse = (res: Response, data: any = null, message: string = 'success') => {
  res.json({
    code: 0,
    message,
    data
  });
};

export const errorResponse = (res: Response, statusCode: number, message: string, code: string = 'error') => {
  res.status(statusCode).json({
    code,
    message,
    data: null
  });
};
