import { Router } from 'express';
import * as statsController from '../controllers/stats.controller';
import { staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/dashboard', staffAuth, statsController.getDashboardStats);
router.get('/reservations', staffAuth, statsController.getReservationStats);
router.get('/reservations/source-breakdown', staffAuth, statsController.getSourceBreakdown);
router.get('/members', staffAuth, statsController.getMemberStats);
router.get('/venue-utilization', staffAuth, statsController.getVenueUtilization);

router.get('/quota/check', staffAuth, statsController.checkQuotaReconciliation);
router.post('/quota/fix', staffAuth, statsController.fixQuotaReconciliation);

router.get('/audits/pending', staffAuth, statsController.getPendingAudits);
router.get('/audits', staffAuth, statsController.getAuditList);
router.post('/activity/:id/audit', staffAuth, statsController.auditActivity);

router.get('/operation-logs', staffAuth, statsController.getOperationLogs);

export default router;
