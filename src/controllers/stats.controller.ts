import { Request, Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { sendMessage } from '../services/message.service';
import dayjs from 'dayjs';

export const getDashboardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { start_date, end_date } = req.query;

  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  const totalUsers = await get('SELECT COUNT(*) as count FROM users', []);
  const totalMembers = await get('SELECT COUNT(*) as count FROM members WHERE status = 1', []);
  const totalVenues = await get('SELECT COUNT(*) as count FROM venues WHERE status = 1', []);
  const totalActivities = await get(
    "SELECT COUNT(*) as count FROM activities WHERE status = 'published'",
    []
  );

  const reservationStats = await get(
    `SELECT 
       COUNT(*) as total_reservations,
       SUM(CASE WHEN r.status = 'confirmed' AND r.is_waitlist = 0 THEN 1 ELSE 0 END) as confirmed_count,
       SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) as checked_in_count,
       SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
       SUM(CASE WHEN r.is_no_show = 1 THEN 1 ELSE 0 END) as no_show_count,
       SUM(r.visitor_count) as total_visitors
     FROM reservations r
     WHERE r.date >= ? AND r.date <= ?`,
    [startDate, endDate]
  );

  const activityStats = await get(
    `SELECT 
       COUNT(*) as total_registrations,
       SUM(CASE WHEN ar.status = 'registered' AND ar.is_waitlist = 0 THEN 1 ELSE 0 END) as registered_count,
       SUM(CASE WHEN ar.checked_in = 1 THEN 1 ELSE 0 END) as checked_in_count,
       SUM(ar.participant_count) as total_participants
     FROM activity_registrations ar
     WHERE DATE(ar.created_at) >= ? AND DATE(ar.created_at) <= ?`,
    [startDate, endDate]
  );

  const groupStats = await get(
    `SELECT 
       COUNT(*) as total_groups,
       SUM(gr.total_people) as total_group_people
     FROM group_reservations gr
     WHERE gr.date >= ? AND gr.date <= ? AND gr.audit_status = 'approved'`,
    [startDate, endDate]
  );

  const dailyTrend = await all(
    `SELECT 
       date,
       SUM(CASE WHEN type = 'reservation' THEN count ELSE 0 END) as reservation_count,
       SUM(CASE WHEN type = 'activity' THEN count ELSE 0 END) as activity_count
     FROM (
       SELECT date as date, COUNT(*) as count, 'reservation' as type
       FROM reservations 
       WHERE date >= ? AND date <= ? AND is_waitlist = 0
       GROUP BY date
       UNION ALL
       SELECT DATE(created_at) as date, COUNT(*) as count, 'activity' as type
       FROM activity_registrations
       WHERE DATE(created_at) >= ? AND DATE(created_at) <= ? AND is_waitlist = 0
       GROUP BY DATE(created_at)
     )
     GROUP BY date
     ORDER BY date ASC`,
    [startDate, endDate, startDate, endDate]
  );

  const venueStats = await all(
    `SELECT 
       v.id,
       v.name,
       COUNT(r.id) as reservation_count,
       SUM(r.visitor_count) as visitor_count
     FROM venues v
     LEFT JOIN reservations r ON v.id = r.venue_id 
       AND r.date >= ? AND r.date <= ? 
       AND r.status = 'confirmed' AND r.is_waitlist = 0
     GROUP BY v.id
     ORDER BY visitor_count DESC`,
    [startDate, endDate]
  );

  const activityRanking = await all(
    `SELECT 
       a.id,
       a.title,
       a.category,
       COUNT(ar.id) as registration_count,
       a.max_participants,
       a.registered_count
     FROM activities a
     LEFT JOIN activity_registrations ar ON a.id = ar.activity_id 
       AND ar.status = 'registered' AND ar.is_waitlist = 0
     WHERE a.status = 'published'
     GROUP BY a.id
     ORDER BY registration_count DESC
     LIMIT 10`,
    []
  );

  successResponse(res, {
    summary: {
      total_users: totalUsers?.count || 0,
      total_members: totalMembers?.count || 0,
      total_venues: totalVenues?.count || 0,
      total_activities: totalActivities?.count || 0
    },
    reservation: {
      total: reservationStats?.total_reservations || 0,
      confirmed: reservationStats?.confirmed_count || 0,
      checked_in: reservationStats?.checked_in_count || 0,
      cancelled: reservationStats?.cancelled_count || 0,
      no_show: reservationStats?.no_show_count || 0,
      total_visitors: reservationStats?.total_visitors || 0
    },
    activity: {
      total: activityStats?.total_registrations || 0,
      registered: activityStats?.registered_count || 0,
      checked_in: activityStats?.checked_in_count || 0,
      total_participants: activityStats?.total_participants || 0
    },
    group: {
      total: groupStats?.total_groups || 0,
      total_people: groupStats?.total_group_people || 0
    },
    daily_trend: dailyTrend,
    venue_stats: venueStats,
    activity_ranking: activityRanking,
    date_range: { start_date: startDate, end_date: endDate }
  });
});

export const getReservationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { venue_id, start_date, end_date, group_by = 'day' } = req.query;

  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let venueCondition = '';
  let params: any[] = [startDate, endDate];

  if (venue_id) {
    venueCondition = ' AND r.venue_id = ?';
    params.push(venue_id);
  }

  let groupField = 'r.date';
  if (group_by === 'month') {
    groupField = "strftime('%Y-%m', r.date)";
  } else if (group_by === 'week') {
    groupField = "strftime('%Y-W%W', r.date)";
  }

  const stats = await all(
    `SELECT 
       ${groupField} as period,
       COUNT(*) as total_reservations,
       SUM(CASE WHEN r.status = 'confirmed' AND r.is_waitlist = 0 THEN 1 ELSE 0 END) as confirmed_count,
       SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) as checked_in_count,
       SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
       SUM(CASE WHEN r.is_no_show = 1 THEN 1 ELSE 0 END) as no_show_count,
       SUM(r.visitor_count) as total_visitors
     FROM reservations r
     WHERE r.date >= ? AND r.date <= ?${venueCondition}
     GROUP BY ${groupField}
     ORDER BY period ASC`,
    params
  );

  const sourceStats = await all(
    `SELECT 
       source,
       COUNT(*) as count,
       SUM(visitor_count) as visitor_count
     FROM reservations
     WHERE date >= ? AND date <= ? AND is_waitlist = 0
     GROUP BY source
     ORDER BY count DESC`,
    [startDate, endDate]
  );

  successResponse(res, {
    stats,
    source_stats: sourceStats,
    date_range: { start_date: startDate, end_date: endDate }
  });
});

export const getMemberStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { start_date, end_date } = req.query;

  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  const levelStats = await all(
    `SELECT 
       member_level,
       COUNT(*) as count
     FROM members
     WHERE status = 1
     GROUP BY member_level
     ORDER BY count DESC`,
    []
  );

  const totalPoints = await get(
    'SELECT SUM(points) as total_points, SUM(total_points) as total_earned FROM members WHERE status = 1',
    []
  );

  const newMembers = await get(
    `SELECT COUNT(*) as count FROM members 
     WHERE DATE(join_date) >= ? AND DATE(join_date) <= ?`,
    [startDate, endDate]
  );

  const growthTrend = await all(
    `SELECT 
       DATE(join_date) as date,
       COUNT(*) as new_count
     FROM members
     WHERE DATE(join_date) >= ? AND DATE(join_date) <= ?
     GROUP BY DATE(join_date)
     ORDER BY date ASC`,
    [startDate, endDate]
  );

  const activityParticipation = await all(
    `SELECT 
       u.id,
       u.real_name,
       u.phone,
       m.member_no,
       m.member_level,
       COUNT(ar.id) as activity_count
     FROM members m
     LEFT JOIN users u ON m.user_id = u.id
     LEFT JOIN activity_registrations ar ON m.user_id = ar.user_id
     WHERE m.status = 1
     GROUP BY m.id
     ORDER BY activity_count DESC
     LIMIT 20`,
    []
  );

  successResponse(res, {
    level_stats: levelStats,
    total_points: totalPoints?.total_points || 0,
    total_earned: totalPoints?.total_earned || 0,
    new_members: newMembers?.count || 0,
    growth_trend: growthTrend,
    activity_ranking: activityParticipation,
    date_range: { start_date: startDate, end_date: endDate }
  });
});

export const auditActivity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const operatorId = req.user!.id;
  const { id } = req.params;
  const { audit_status, audit_remark } = req.body;

  if (!audit_status || !['approved', 'rejected'].includes(audit_status)) {
    throw new ApiError(400, '审核状态无效', 'invalid_params');
  }

  const activity = await get('SELECT * FROM activities WHERE id = ?', [id]);
  if (!activity) {
    throw new ApiError(404, '活动不存在', 'not_found');
  }

  if (activity.audit_status !== 'pending') {
    throw new ApiError(400, '该活动已审核，请勿重复操作', 'invalid_operation');
  }

  const newStatus = audit_status === 'approved' ? 'published' : 'rejected';

  await run(
    `UPDATE activities 
     SET audit_status = ?, audit_by = ?, audit_time = CURRENT_TIMESTAMP, 
         audit_remark = ?, status = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [audit_status, operatorId, audit_remark || '', newStatus, id]
  );

  await run(
    `INSERT INTO audit_logs (operator_id, target_type, target_id, action, remark) 
     VALUES (?, ?, ?, ?, ?)`,
    [operatorId, 'activity', id, audit_status === 'approved' ? 'audit_approve' : 'audit_reject', audit_remark || '']
  );

  if (activity.created_by) {
    await sendMessage(
      activity.created_by,
      audit_status === 'approved' ? '活动审核通过' : '活动审核未通过',
      audit_status === 'approved'
        ? `您的活动《${activity.title}》已审核通过，正式发布。`
        : `您的活动《${activity.title}》审核未通过。原因：${audit_remark || '无'}`,
      'system',
      Number(id),
      'activity'
    );
  }

  const updated = await get('SELECT * FROM activities WHERE id = ?', [id]);
  successResponse(res, updated, '审核完成');
});

export const getAuditList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { type, status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT al.*, u.real_name as operator_name
             FROM audit_logs al
             LEFT JOIN users u ON al.operator_id = u.id
             WHERE 1=1`;
  let params: any[] = [];

  if (type) {
    sql += ' AND al.target_type = ?';
    params.push(type);
  }
  if (status) {
    sql += ' AND al.action LIKE ?';
    params.push(`%${status}%`);
  }

  const countSql = sql.replace('SELECT al.*, u.real_name as operator_name', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getPendingAudits = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { type } = req.query;

  const result: any = {};

  if (!type || type === 'activity') {
    const pendingActivities = await all(
      `SELECT a.*, u.real_name as creator_name
       FROM activities a
       LEFT JOIN users u ON a.created_by = u.id
       WHERE a.audit_status = 'pending'
       ORDER BY a.created_at DESC
       LIMIT 20`,
      []
    );
    result.activities = pendingActivities;
  }

  if (!type || type === 'group') {
    const pendingGroups = await all(
      `SELECT gr.*, u.real_name as applicant_name, v.name as venue_name
       FROM group_reservations gr
       LEFT JOIN users u ON gr.user_id = u.id
       LEFT JOIN venues v ON gr.venue_id = v.id
       WHERE gr.audit_status = 'pending' AND gr.status != 'cancelled'
       ORDER BY gr.created_at DESC
       LIMIT 20`,
      []
    );
    result.groups = pendingGroups;
  }

  successResponse(res, result);
});

export const getOperationLogs = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { module, user_id, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT ol.*, u.username, u.real_name
             FROM operation_logs ol
             LEFT JOIN users u ON ol.user_id = u.id
             WHERE 1=1`;
  let params: any[] = [];

  if (module) {
    sql += ' AND ol.module = ?';
    params.push(module);
  }
  if (user_id) {
    sql += ' AND ol.user_id = ?';
    params.push(user_id);
  }

  const countSql = sql.replace('SELECT ol.*, u.username, u.real_name', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY ol.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getVenueUtilization = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { venue_id, start_date, end_date } = req.query;

  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let venueCondition = '';
  let params: any[] = [startDate, endDate];

  if (venue_id) {
    venueCondition = ' AND r.venue_id = ?';
    params.push(venue_id);
  }

  const stats = await all(
    `SELECT 
       v.id as venue_id,
       v.name as venue_name,
       v.capacity,
       COUNT(r.id) as reservation_count,
       SUM(r.visitor_count) as total_visitors,
       COUNT(DISTINCT r.date) as open_days
     FROM venues v
     LEFT JOIN reservations r ON v.id = r.venue_id 
       AND r.date >= ? AND r.date <= ? 
       AND r.status = 'confirmed' AND r.is_waitlist = 0
     WHERE v.status = 1 ${venueCondition ? venueCondition.replace('AND', 'AND') : ''}
     GROUP BY v.id`,
    params
  );

  const utilization = stats.map(s => ({
    ...s,
    daily_avg: s.open_days > 0 ? Math.round(s.total_visitors / s.open_days) : 0,
    utilization_rate: s.capacity > 0 && s.open_days > 0
      ? Math.min(100, Math.round((s.total_visitors / (s.capacity * s.open_days)) * 100))
      : 0
  }));

  successResponse(res, {
    utilization,
    date_range: { start_date: startDate, end_date: endDate }
  });
});

export const getSourceBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { venue_id, start_date, end_date } = req.query;

  const startDate = start_date || dayjs().subtract(30, 'day').format('YYYY-MM-DD');
  const endDate = end_date || dayjs().format('YYYY-MM-DD');

  let venueCondition = '';
  let params: any[] = [startDate, endDate];

  if (venue_id) {
    venueCondition = ' AND r.venue_id = ?';
    params.push(venue_id);
  }

  const personalBySource = await all(
    `SELECT 
       r.source,
       COUNT(*) as total_count,
       SUM(CASE WHEN r.is_waitlist = 0 THEN 1 ELSE 0 END) as reservation_count,
       SUM(CASE WHEN r.is_waitlist = 0 THEN r.visitor_count ELSE 0 END) as reservation_people,
       SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancel_count,
       SUM(CASE WHEN r.status = 'cancelled' THEN r.visitor_count ELSE 0 END) as cancel_people,
       SUM(CASE WHEN r.is_waitlist = 1 THEN 1 ELSE 0 END) as waitlist_count,
       SUM(CASE WHEN r.is_waitlist = 1 THEN r.visitor_count ELSE 0 END) as waitlist_people,
       SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) as checkin_count,
       SUM(CASE WHEN r.checked_in = 1 THEN r.visitor_count ELSE 0 END) as checkin_people
     FROM reservations r
     WHERE r.date >= ? AND r.date <= ?${venueCondition}
     GROUP BY r.source`,
    params
  );

  let groupParams: any[] = [startDate, endDate];
  let groupVenueCondition = '';
  if (venue_id) {
    groupVenueCondition = ' AND gr.venue_id = ?';
    groupParams.push(venue_id);
  }

  const groupBySource = await all(
    `SELECT 
       gr.source,
       COUNT(*) as group_count,
       SUM(gr.total_people) as group_people,
       SUM(CASE WHEN gr.status = 'cancelled' THEN 1 ELSE 0 END) as group_cancel_count,
       SUM(CASE WHEN gr.status = 'cancelled' THEN gr.total_people ELSE 0 END) as group_cancel_people,
       SUM(CASE WHEN gr.checked_in_count IS NOT NULL THEN gr.checked_in_count ELSE 0 END) as group_checkin_people
     FROM group_reservations gr
     WHERE gr.date >= ? AND gr.date <= ?${groupVenueCondition}
     GROUP BY gr.source`,
    groupParams
  );

  const sourceMap: Record<string, any> = {};
  const sourceLabels: Record<string, string> = {
    web: '官网',
    miniapp: '小程序',
    kiosk: '自助机',
    backend: '后台管理',
    admin: '后台管理'
  };

  for (const label of ['web', 'miniapp', 'kiosk', 'backend']) {
    sourceMap[label] = {
      source: label,
      source_name: sourceLabels[label] || label,
      reservation_count: 0,
      reservation_people: 0,
      group_count: 0,
      group_people: 0,
      cancel_count: 0,
      cancel_people: 0,
      waitlist_count: 0,
      waitlist_people: 0,
      checkin_count: 0,
      checkin_people: 0
    };
  }

  for (const row of personalBySource) {
    const s = row.source || 'web';
    if (!sourceMap[s]) {
      sourceMap[s] = {
        source: s,
        source_name: sourceLabels[s] || s,
        reservation_count: 0,
        reservation_people: 0,
        group_count: 0,
        group_people: 0,
        cancel_count: 0,
        cancel_people: 0,
        waitlist_count: 0,
        waitlist_people: 0,
        checkin_count: 0,
        checkin_people: 0
      };
    }
    sourceMap[s].reservation_count += row.reservation_count || 0;
    sourceMap[s].reservation_people += row.reservation_people || 0;
    sourceMap[s].cancel_count += row.cancel_count || 0;
    sourceMap[s].cancel_people += row.cancel_people || 0;
    sourceMap[s].waitlist_count += row.waitlist_count || 0;
    sourceMap[s].waitlist_people += row.waitlist_people || 0;
    sourceMap[s].checkin_count += row.checkin_count || 0;
    sourceMap[s].checkin_people += row.checkin_people || 0;
  }

  for (const row of groupBySource) {
    const s = row.source || 'web';
    if (!sourceMap[s]) {
      sourceMap[s] = {
        source: s,
        source_name: sourceLabels[s] || s,
        reservation_count: 0,
        reservation_people: 0,
        group_count: 0,
        group_people: 0,
        cancel_count: 0,
        cancel_people: 0,
        waitlist_count: 0,
        waitlist_people: 0,
        checkin_count: 0,
        checkin_people: 0
      };
    }
    sourceMap[s].group_count += row.group_count || 0;
    sourceMap[s].group_people += row.group_people || 0;
    sourceMap[s].cancel_count += row.group_cancel_count || 0;
    sourceMap[s].cancel_people += row.group_cancel_people || 0;
    sourceMap[s].checkin_people += row.group_checkin_people || 0;
  }

  const breakdown = Object.values(sourceMap).map(item => ({
    ...item,
    total_reservations: item.reservation_count + item.group_count,
    total_people: item.reservation_people + item.group_people,
    total_cancel_count: item.cancel_count,
    total_cancel_people: item.cancel_people,
    total_checkin_people: item.checkin_people
  }));

  const summary = breakdown.reduce((acc: any, item: any) => {
    acc.reservation_count += item.reservation_count;
    acc.reservation_people += item.reservation_people;
    acc.group_count += item.group_count;
    acc.group_people += item.group_people;
    acc.cancel_count += item.cancel_count;
    acc.cancel_people += item.cancel_people;
    acc.waitlist_count += item.waitlist_count;
    acc.waitlist_people += item.waitlist_people;
    acc.checkin_count += item.checkin_count;
    acc.checkin_people += item.checkin_people;
    return acc;
  }, {
    reservation_count: 0, reservation_people: 0,
    group_count: 0, group_people: 0,
    cancel_count: 0, cancel_people: 0,
    waitlist_count: 0, waitlist_people: 0,
    checkin_count: 0, checkin_people: 0
  });

  successResponse(res, {
    summary: {
      ...summary,
      total_reservations: summary.reservation_count + summary.group_count,
      total_people: summary.reservation_people + summary.group_people
    },
    breakdown,
    date_range: { start_date: startDate, end_date: endDate },
    venue_id: venue_id || null
  });
});

export const checkQuotaReconciliation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { venue_id, date } = req.query;

  let venueCondition = '';
  let params: any[] = [];

  if (venue_id) {
    venueCondition += ' AND ts.venue_id = ?';
    params.push(venue_id);
  }
  if (date) {
    venueCondition += ' AND ts.date = ?';
    params.push(date);
  }

  const timeSlots = await all(
    `SELECT ts.id, ts.venue_id, ts.date, ts.start_time, ts.end_time,
            ts.total_quota, ts.reserved_count as stored_reserved, ts.waitlist_count as stored_waitlist
     FROM time_slots ts
     WHERE 1=1 ${venueCondition}
     ORDER BY ts.venue_id, ts.date, ts.start_time`,
    params
  );

  const slotDetails = [];
  let slotMismatchCount = 0;

  for (const ts of timeSlots) {
    const reservedActual = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE time_slot_id = ? AND status != 'cancelled' AND is_waitlist = 0`,
      [ts.id]
    );
    const groupReservedActual = await get(
      `SELECT COALESCE(SUM(total_people), 0) as total FROM group_reservations 
       WHERE time_slot_id = ? AND status NOT IN ('cancelled', 'rejected') AND audit_status != 'rejected'`,
      [ts.id]
    );
    const waitlistActual = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE time_slot_id = ? AND status = 'confirmed' AND is_waitlist = 1`,
      [ts.id]
    );

    const calcReserved = (reservedActual?.total || 0) + (groupReservedActual?.total || 0);
    const calcWaitlist = waitlistActual?.total || 0;
    const mismatchReserved = calcReserved !== ts.stored_reserved;
    const mismatchWaitlist = calcWaitlist !== ts.stored_waitlist;

    if (mismatchReserved || mismatchWaitlist) {
      slotMismatchCount++;
    }

    slotDetails.push({
      time_slot_id: ts.id,
      venue_id: ts.venue_id,
      date: ts.date,
      time: `${ts.start_time}-${ts.end_time}`,
      total_quota: ts.total_quota,
      stored_reserved: ts.stored_reserved,
      calc_reserved: calcReserved,
      reserved_diff: calcReserved - ts.stored_reserved,
      stored_waitlist: ts.stored_waitlist,
      calc_waitlist: calcWaitlist,
      waitlist_diff: calcWaitlist - ts.stored_waitlist,
      mismatch: mismatchReserved || mismatchWaitlist
    });
  }

  let dateCondition = '';
  let dateParams: any[] = [];
  if (venue_id) {
    dateCondition += ' AND venue_id = ?';
    dateParams.push(venue_id);
  }
  if (date) {
    dateCondition += ' AND date = ?';
    dateParams.push(date);
  }

  const calendarSettings = await all(
    `SELECT cs.venue_id, cs.date, cs.daily_limit, v.name as venue_name
     FROM calendar_settings cs
     LEFT JOIN venues v ON cs.venue_id = v.id
     WHERE 1=1 ${dateCondition}
     ORDER BY cs.venue_id, cs.date`,
    dateParams
  );

  const dailyDetails = [];
  let dailyMismatchCount = 0;

  for (const cs of calendarSettings) {
    const personDay = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE venue_id = ? AND date = ? AND status != 'cancelled' AND is_waitlist = 0`,
      [cs.venue_id, cs.date]
    );
    const groupDay = await get(
      `SELECT COALESCE(SUM(total_people), 0) as total FROM group_reservations 
       WHERE venue_id = ? AND date = ? AND status NOT IN ('cancelled', 'rejected') AND audit_status != 'rejected'`,
      [cs.venue_id, cs.date]
    );
    const calcUsed = (personDay?.total || 0) + (groupDay?.total || 0);

    dailyDetails.push({
      venue_id: cs.venue_id,
      venue_name: cs.venue_name,
      date: cs.date,
      daily_limit: cs.daily_limit || null,
      calc_used: calcUsed,
      remaining: cs.daily_limit ? Math.max(0, cs.daily_limit - calcUsed) : null
    });
  }

  const activities = await all(
    `SELECT a.id, a.title, a.max_participants, a.registered_count as stored_registered, a.waitlist_count as stored_waitlist
     FROM activities a
     WHERE a.max_participants IS NOT NULL`,
    []
  );

  const activityDetails = [];
  let activityMismatchCount = 0;

  for (const a of activities) {
    const regActual = await get(
      `SELECT COALESCE(SUM(participant_count), 0) as total FROM activity_registrations 
       WHERE activity_id = ? AND status != 'cancelled' AND is_waitlist = 0`,
      [a.id]
    );
    const waitActual = await get(
      `SELECT COALESCE(SUM(participant_count), 0) as total FROM activity_registrations 
       WHERE activity_id = ? AND status = 'registered' AND is_waitlist = 1`,
      [a.id]
    );
    const calcReg = regActual?.total || 0;
    const calcWait = waitActual?.total || 0;
    const mismatchR = calcReg !== a.stored_registered;
    const mismatchW = calcWait !== a.stored_waitlist;

    if (mismatchR || mismatchW) {
      activityMismatchCount++;
    }

    activityDetails.push({
      activity_id: a.id,
      title: a.title,
      max_participants: a.max_participants,
      stored_registered: a.stored_registered,
      calc_registered: calcReg,
      registered_diff: calcReg - a.stored_registered,
      stored_waitlist: a.stored_waitlist,
      calc_waitlist: calcWait,
      waitlist_diff: calcWait - a.stored_waitlist,
      mismatch: mismatchR || mismatchW
    });
  }

  successResponse(res, {
    summary: {
      total_slots: slotDetails.length,
      slot_mismatch: slotMismatchCount,
      total_activities: activityDetails.length,
      activity_mismatch: activityMismatchCount
    },
    time_slots: slotDetails,
    daily_limits: dailyDetails,
    activities: activityDetails
  });
});

export const fixQuotaReconciliation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const operatorId = req.user!.id;
  const { venue_id, date, fix_activities = true } = req.body;

  let venueCondition = '';
  let params: any[] = [];

  if (venue_id) {
    venueCondition += ' AND ts.venue_id = ?';
    params.push(venue_id);
  }
  if (date) {
    venueCondition += ' AND ts.date = ?';
    params.push(date);
  }

  const timeSlots = await all(
    `SELECT ts.id, ts.reserved_count, ts.waitlist_count FROM time_slots ts WHERE 1=1 ${venueCondition}`,
    params
  );

  let fixedSlotCount = 0;
  const fixLogs: string[] = [];

  for (const ts of timeSlots) {
    const reservedActual = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE time_slot_id = ? AND status != 'cancelled' AND is_waitlist = 0`,
      [ts.id]
    );
    const groupReservedActual = await get(
      `SELECT COALESCE(SUM(total_people), 0) as total FROM group_reservations 
       WHERE time_slot_id = ? AND status NOT IN ('cancelled', 'rejected') AND audit_status != 'rejected'`,
      [ts.id]
    );
    const waitlistActual = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE time_slot_id = ? AND status = 'confirmed' AND is_waitlist = 1`,
      [ts.id]
    );

    const calcReserved = (reservedActual?.total || 0) + (groupReservedActual?.total || 0);
    const calcWaitlist = waitlistActual?.total || 0;

    if (calcReserved !== ts.reserved_count || calcWaitlist !== ts.waitlist_count) {
      await run(
        'UPDATE time_slots SET reserved_count = ?, waitlist_count = ? WHERE id = ?',
        [calcReserved, calcWaitlist, ts.id]
      );
      fixedSlotCount++;
      fixLogs.push(`时段#${ts.id}: reserved ${ts.reserved_count}→${calcReserved}, waitlist ${ts.waitlist_count}→${calcWaitlist}`);
    }
  }

  let fixedActivityCount = 0;

  if (fix_activities) {
    const activities = await all(
      `SELECT a.id, a.registered_count, a.waitlist_count FROM activities a WHERE a.max_participants IS NOT NULL`,
      []
    );

    for (const a of activities) {
      const regActual = await get(
        `SELECT COALESCE(SUM(participant_count), 0) as total FROM activity_registrations 
         WHERE activity_id = ? AND status != 'cancelled' AND is_waitlist = 0`,
        [a.id]
      );
      const waitActual = await get(
        `SELECT COALESCE(SUM(participant_count), 0) as total FROM activity_registrations 
         WHERE activity_id = ? AND status = 'registered' AND is_waitlist = 1`,
        [a.id]
      );
      const calcReg = regActual?.total || 0;
      const calcWait = waitActual?.total || 0;

      if (calcReg !== a.registered_count || calcWait !== a.waitlist_count) {
        await run(
          'UPDATE activities SET registered_count = ?, waitlist_count = ? WHERE id = ?',
          [calcReg, calcWait, a.id]
        );
        fixedActivityCount++;
        fixLogs.push(`活动#${a.id}: registered ${a.registered_count}→${calcReg}, waitlist ${a.waitlist_count}→${calcWait}`);
      }
    }
  }

  await run(
    `INSERT INTO operation_logs (user_id, module, action, params, ip) 
     VALUES (?, ?, ?, ?, ?)`,
    [
      operatorId,
      'quota',
      'reconciliation_fix',
      JSON.stringify({
        fixed_slots: fixedSlotCount,
        fixed_activities: fixedActivityCount,
        logs: fixLogs.slice(0, 50),
        filters: { venue_id: venue_id || null, date: date || null }
      }),
      req.ip || ''
    ]
  );

  successResponse(res, {
    fixed_slots: fixedSlotCount,
    fixed_activities: fixedActivityCount,
    fix_logs: fixLogs
  }, '名额修复完成');
});
