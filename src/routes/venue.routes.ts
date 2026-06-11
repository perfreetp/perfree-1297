import { Router } from 'express';
import * as venueController from '../controllers/venue.controller';
import { staffAuth, userAuth } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', venueController.getVenueList);
router.get('/:id', venueController.getVenueDetail);
router.post('/', staffAuth, venueController.createVenue);
router.put('/:id', staffAuth, venueController.updateVenue);

router.get('/calendar', venueController.getCalendar);
router.post('/calendar/day', staffAuth, venueController.setCalendarDay);

router.post('/timeslot', staffAuth, venueController.setTimeSlot);
router.post('/timeslot/batch', staffAuth, venueController.batchSetTimeSlots);
router.delete('/timeslot/:id', staffAuth, venueController.deleteTimeSlot);

export default router;
