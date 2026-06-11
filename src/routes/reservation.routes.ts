import { Router } from 'express';
import * as reservationController from '../controllers/reservation.controller';
import { userAuth, staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/', userAuth, reservationController.createReservation);
router.get('/mine', userAuth, reservationController.getReservationList);
router.get('/:id', userAuth, reservationController.getReservationDetail);
router.post('/:id/cancel', userAuth, reservationController.cancelReservation);
router.post('/:id/reschedule', userAuth, reservationController.rescheduleReservation);

router.get('/ticket/:ticket_code', staffAuth, reservationController.getReservationByTicketCode);
router.post('/checkin', staffAuth, reservationController.checkIn);

router.get('/noshow/list', staffAuth, reservationController.getNoShowList);
router.post('/:id/mark-noshow', staffAuth, reservationController.markNoShow);

export default router;
