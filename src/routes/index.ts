import { Router } from 'express';
import authRoutes from './auth.routes';
import venueRoutes from './venue.routes';
import reservationRoutes from './reservation.routes';
import groupRoutes from './group.routes';
import ticketRoutes from './ticket.routes';
import activityRoutes from './activity.routes';
import memberRoutes from './member.routes';
import statsRoutes from './stats.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/venues', venueRoutes);
router.use('/reservations', reservationRoutes);
router.use('/group-reservations', groupRoutes);
router.use('/tickets', ticketRoutes);
router.use('/activities', activityRoutes);
router.use('/members', memberRoutes);
router.use('/stats', statsRoutes);

export default router;
