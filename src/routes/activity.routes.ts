import { Router } from 'express';
import * as activityController from '../controllers/activity.controller';
import { userAuth, staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', activityController.getActivityList);
router.post('/', staffAuth, activityController.createActivity);
router.post('/register', userAuth, activityController.registerActivity);
router.get('/mine/list', userAuth, activityController.getMyRegistrations);
router.post('/questionnaire', staffAuth, activityController.setQuestionnaire);
router.get('/questionnaire/:activity_id', activityController.getQuestionnaire);
router.get('/admin/registrations', staffAuth, activityController.getRegistrationList);
router.get('/admin/export', staffAuth, activityController.exportRegistrationList);

router.get('/:id', activityController.getActivityDetail);
router.put('/:id', staffAuth, activityController.updateActivity);
router.get('/registration/:id', userAuth, activityController.getRegistrationDetail);
router.post('/registration/:id/cancel', userAuth, activityController.cancelRegistration);

export default router;
