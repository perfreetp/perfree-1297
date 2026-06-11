import { Router } from 'express';
import * as ticketController from '../controllers/ticket.controller';
import { staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/verify', staffAuth, ticketController.verifyTicket);
router.post('/checkin', staffAuth, ticketController.checkInByTicket);
router.post('/batch-checkin', staffAuth, ticketController.batchCheckIn);
router.get('/today-stats', staffAuth, ticketController.getTodayCheckInStats);
router.get('/noshow', staffAuth, ticketController.getNoShowRecords);

export default router;
