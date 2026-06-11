import { Router } from 'express';
import * as statsController from '../controllers/stats.controller';
import { staffAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/dashboard', staffAuth, statsController.getDashboardStats);
router.get('/reservations', staffAuth, statsController.getReservationStats);
router.get('/reservations/source-breakdown', staffAuth, statsController.getSourceBreakdown);
router.get('/reservations/multidim', staffAuth, statsController.getMultidimStats);
router.get('/reservations/multidim/export', staffAuth, statsController.exportMultidimStats);
router.get('/reservations/overview', staffAuth, statsController.getReservationOverview);
router.get('/members', staffAuth, statsController.getMemberStats);
router.get('/venue-utilization', staffAuth, statsController.getVenueUtilization);

router.get('/quota/check', staffAuth, statsController.checkQuotaReconciliation);
router.post('/quota/fix', staffAuth, statsController.fixQuotaReconciliation);
router.get('/quota/batch-check', staffAuth, statsController.batchCheckQuota);
router.post('/quota/batch-fix', staffAuth, statsController.batchFixQuota);
router.get('/quota/detailed-check', staffAuth, statsController.detailedCheckQuota);
router.post('/quota/detailed-fix', staffAuth, statsController.detailedFixQuota);

router.get('/audits/pending', staffAuth, statsController.getPendingAudits);
router.get('/audits', staffAuth, statsController.getAuditList);
router.post('/activity/:id/audit', staffAuth, statsController.auditActivity);

router.get('/operation-logs', staffAuth, statsController.getOperationLogs);

export default router;
