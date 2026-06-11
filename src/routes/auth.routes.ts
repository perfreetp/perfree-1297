import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { userAuth } from '../middlewares/auth.middleware';

const router = Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', userAuth, authController.logout);
router.get('/me', userAuth, authController.getCurrentUser);
router.put('/password', userAuth, authController.changePassword);
router.put('/profile', userAuth, authController.updateProfile);

export default router;
