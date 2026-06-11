import { Router } from 'express';
import * as memberController from '../controllers/member.controller';
import { userAuth, staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/info', userAuth, memberController.getMemberInfo);
router.post('/register', userAuth, memberController.createMember);
router.put('/profile', userAuth, memberController.updateMemberProfile);

router.get('/points/records', userAuth, memberController.getPointRecords);
router.post('/points/deduct', userAuth, memberController.deductPoints);

router.get('/messages', userAuth, memberController.getMessageList);
router.get('/messages/unread-count', userAuth, memberController.getUnreadCount);
router.post('/messages/:id/read', userAuth, memberController.markMessageRead);
router.post('/messages/read-all', userAuth, memberController.markAllMessagesRead);

router.get('/admin/list', staffAuth, memberController.getMemberList);
router.get('/admin/user/:user_id', staffAuth, memberController.getMemberInfoByUserId);
router.post('/admin/add-points', staffAuth, memberController.addPoints);
router.put('/admin/:id/level', staffAuth, memberController.updateMemberLevel);

export default router;
