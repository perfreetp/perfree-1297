import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import routes from './routes';
import { ApiError, errorResponse } from './utils/response';
import './database';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    code: 0,
    message: 'success',
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: '数字文化馆预约与活动后端服务',
      version: '1.0.0'
    }
  });
});

app.use('/api', routes);

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('错误:', err);

  if (err instanceof ApiError) {
    return errorResponse(res, err.statusCode, err.message, err.code);
  }

  return errorResponse(res, 500, '服务器内部错误', 'internal_error');
});

app.use((req: Request, res: Response) => {
  errorResponse(res, 404, '接口不存在', 'not_found');
});

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   数字文化馆预约与活动后端服务已启动                           ║
║                                                               ║
║   服务地址: http://localhost:${PORT}                           ║
║   健康检查: http://localhost:${PORT}/api/health                ║
║                                                               ║
║   测试账号:                                                   ║
║     管理员: admin / admin123                                  ║
║     工作人员: staff / staff123                                ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

export default app;
