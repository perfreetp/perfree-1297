import { Router } from 'express';
import * as groupController from '../controllers/groupReservation.controller';
import { userAuth, staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/', userAuth, groupController.createGroupReservation);
router.get('/mine', userAuth, groupController.getGroupReservationList);
router.get('/:id', userAuth, groupController.getGroupReservationDetail);
router.post('/:id/cancel', userAuth, groupController.cancelGroupReservation);
router.post('/:id/import', userAuth, groupController.importGroupMembers);

router.get('/admin/list', staffAuth, groupController.getAdminGroupList);
router.post('/:id/audit', staffAuth, groupController.auditGroupReservation);
router.post('/checkin', staffAuth, groupController.groupCheckIn);

export default router;
