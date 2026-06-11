import { Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import dayjs from 'dayjs';

export const verifyTicket = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_code, type = 'reservation' } = req.body;

  if (!ticket_code) {
    throw new ApiError(400, '票码为必填项', 'invalid_params');
  }

  let result: any = null;

  if (type === 'reservation') {
    result = await get(
      `SELECT r.*, v.name as venue_name, v.address as venue_address,
              ts.start_time, ts.end_time, u.real_name, u.phone as user_phone,
              u.id_card as user_id_card
       FROM reservations r
       LEFT JOIN venues v ON r.venue_id = v.id
       LEFT JOIN time_slots ts ON r.time_slot_id = ts.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.ticket_code = ?`,
      [ticket_code]
    );
  } else if (type === 'activity') {
    result = await get(
      `SELECT ar.*, a.title as activity_title, a.start_time, a.end_time,
              v.name as venue_name, u.real_name, u.phone as user_phone
       FROM activity_registrations ar
       LEFT JOIN activities a ON ar.activity_id = a.id
       LEFT JOIN venues v ON a.venue_id = v.id
       LEFT JOIN users u ON ar.user_id = u.id
       WHERE ar.ticket_code = ?`,
      [ticket_code]
    );
  } else if (type === 'group') {
    result = await get(
      `SELECT gr.*, v.name as venue_name, v.address as venue_address,
              ts.start_time, ts.end_time, u.real_name, u.phone as user_phone
       FROM group_reservations gr
       LEFT JOIN venues v ON gr.venue_id = v.id
       LEFT JOIN time_slots ts ON gr.time_slot_id = ts.id
       LEFT JOIN users u ON gr.user_id = u.id
       WHERE gr.ticket_code = ?`,
      [ticket_code]
    );
  }

  if (!result) {
    throw new ApiError(404, '票码无效', 'invalid_ticket');
  }

  let ticketStatus = 'valid';
  let message = '票码有效';

  if (result.status === 'cancelled' || result.status === 'rejected') {
    ticketStatus = 'cancelled';
    message = '票码已取消';
  } else if (result.status === 'no_show') {
    ticketStatus = 'no_show';
    message = '票码已爽约';
  } else if (result.checked_in === 1) {
    ticketStatus = 'checked_in';
    message = '已签到';
  } else if (result.is_waitlist === 1) {
    ticketStatus = 'waitlist';
    message = '候补票码';
  } else if (result.audit_status && result.audit_status === 'pending') {
    ticketStatus = 'pending';
    message = '待审核';
  }

  const today = dayjs().format('YYYY-MM-DD');
  if (result.date && result.date !== today && ticketStatus === 'valid') {
    const visitDate = dayjs(result.date);
    if (visitDate.isBefore(dayjs(), 'day')) {
      ticketStatus = 'expired';
      message = '票码已过期';
    } else {
      ticketStatus = 'future';
      message = '票码未到使用日期';
    }
  }

  successResponse(res, {
    ...result,
    ticket_status: ticketStatus,
    ticket_type: type,
    message
  });
});

export const checkInByTicket = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_code, type = 'reservation' } = req.body;

  if (!ticket_code) {
    throw new ApiError(400, '票码为必填项', 'invalid_params');
  }

  let result: any = null;
  let tableName = '';
  let idField = '';

  if (type === 'reservation') {
    result = await get('SELECT * FROM reservations WHERE ticket_code = ?', [ticket_code]);
    tableName = 'reservations';
    idField = 'id';
  } else if (type === 'activity') {
    result = await get('SELECT * FROM activity_registrations WHERE ticket_code = ?', [ticket_code]);
    tableName = 'activity_registrations';
    idField = 'id';
  } else if (type === 'group') {
    result = await get('SELECT * FROM group_reservations WHERE ticket_code = ?', [ticket_code]);
    tableName = 'group_reservations';
    idField = 'id';
  }

  if (!result) {
    throw new ApiError(404, '票码不存在', 'not_found');
  }

  if (type === 'reservation' || type === 'activity') {
    if (result.checked_in === 1) {
      throw new ApiError(400, '已签到，请勿重复操作', 'already_checked_in');
    }
    if (result.status !== 'confirmed' && result.status !== 'registered') {
      throw new ApiError(400, '预约状态异常，无法签到', 'invalid_operation');
    }
    if (result.is_waitlist === 1) {
      throw new ApiError(400, '候补票码不能签到', 'invalid_operation');
    }
  } else if (type === 'group') {
    if (result.audit_status !== 'approved' && result.status !== 'confirmed') {
      throw new ApiError(400, '预约审核未通过，无法签到', 'invalid_operation');
    }
    if (result.status === 'cancelled') {
      throw new ApiError(400, '预约已取消', 'invalid_operation');
    }
  }

  const today = dayjs().format('YYYY-MM-DD');
  if (result.date && result.date !== today) {
    throw new ApiError(400, '非今日预约，无法签到', 'invalid_date');
  }

  if (type === 'group') {
    const newCheckedInCount = (result.checked_in_count || 0) + (result.total_people || 1);
    await run(
      `UPDATE ${tableName} 
       SET checked_in_count = ?, checkin_time = CASE WHEN checkin_time IS NULL THEN CURRENT_TIMESTAMP ELSE checkin_time END 
       WHERE ${idField} = ?`,
      [Math.min(newCheckedInCount, result.total_people), result[idField]]
    );
  } else {
    await run(
      `UPDATE ${tableName} SET checked_in = 1, checkin_time = CURRENT_TIMESTAMP WHERE ${idField} = ?`,
      [result[idField]]
    );
  }

  const updated = await get(
    `SELECT * FROM ${tableName} WHERE ${idField} = ?`,
    [result[idField]]
  );

  successResponse(res, updated, '签到成功');
});

export const batchCheckIn = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_codes, type = 'reservation' } = req.body;

  if (!ticket_codes || !Array.isArray(ticket_codes) || ticket_codes.length === 0) {
    throw new ApiError(400, '票码列表不能为空', 'invalid_params');
  }

  const results = [];

  for (const code of ticket_codes) {
    try {
      let result: any = null;
      let tableName = '';
      let idField = '';

      if (type === 'reservation') {
        result = await get('SELECT * FROM reservations WHERE ticket_code = ?', [code]);
        tableName = 'reservations';
        idField = 'id';
      } else if (type === 'activity') {
        result = await get('SELECT * FROM activity_registrations WHERE ticket_code = ?', [code]);
        tableName = 'activity_registrations';
        idField = 'id';
      }

      if (!result) {
        results.push({ code, success: false, message: '票码不存在' });
        continue;
      }

      if (result.checked_in === 1) {
        results.push({ code, success: false, message: '已签到' });
        continue;
      }

      if (result.status !== 'confirmed' && result.status !== 'registered') {
        results.push({ code, success: false, message: '状态异常' });
        continue;
      }

      const today = dayjs().format('YYYY-MM-DD');
      if (result.date && result.date !== today) {
        results.push({ code, success: false, message: '非今日预约' });
        continue;
      }

      await run(
        `UPDATE ${tableName} SET checked_in = 1, checkin_time = CURRENT_TIMESTAMP WHERE ${idField} = ?`,
        [result[idField]]
      );

      results.push({ code, success: true, message: '签到成功' });
    } catch (error: any) {
      results.push({ code, success: false, message: error.message });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  successResponse(res, {
    total: ticket_codes.length,
    success: successCount,
    fail: failCount,
    details: results
  }, `批量签到完成，成功${successCount}张，失败${failCount}张`);
});

export const getTodayCheckInStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { venue_id } = req.query;
  const today = dayjs().format('YYYY-MM-DD');

  let venueCondition = '';
  let params: any[] = [today];

  if (venue_id) {
    venueCondition = ' AND r.venue_id = ?';
    params.push(venue_id);
  }

  const reservationStats = await get(
    `SELECT 
       COUNT(*) as total_reservations,
       SUM(CASE WHEN r.checked_in = 1 THEN 1 ELSE 0 END) as checked_in_count,
       SUM(CASE WHEN r.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
       SUM(CASE WHEN r.is_no_show = 1 THEN 1 ELSE 0 END) as no_show_count,
       SUM(r.visitor_count) as total_visitors
     FROM reservations r
     WHERE r.date = ? ${venueCondition} AND r.is_waitlist = 0`,
    params
  );

  const groupStats = await get(
    `SELECT 
       COUNT(*) as total_groups,
       SUM(gr.total_people) as total_group_people,
       SUM(gr.checked_in_count) as group_checked_in_count
     FROM group_reservations gr
     WHERE gr.date = ? ${venueCondition} AND gr.audit_status = 'approved'`,
    params
  );

  const activityStats = await get(
    `SELECT 
       COUNT(*) as total_registrations,
       SUM(CASE WHEN ar.checked_in = 1 THEN 1 ELSE 0 END) as checked_in_count
     FROM activity_registrations ar
     INNER JOIN activities a ON ar.activity_id = a.id
     WHERE DATE(a.start_time) = ? ${venueCondition ? ' AND a.venue_id = ?' : ''}
       AND ar.status = 'registered' AND ar.is_waitlist = 0`,
    venue_id ? [today, venue_id] : [today]
  );

  successResponse(res, {
    date: today,
    venue_id: venue_id || 'all',
    reservation: {
      total: reservationStats?.total_reservations || 0,
      checked_in: reservationStats?.checked_in_count || 0,
      cancelled: reservationStats?.cancelled_count || 0,
      no_show: reservationStats?.no_show_count || 0,
      total_visitors: reservationStats?.total_visitors || 0
    },
    group: {
      total: groupStats?.total_groups || 0,
      total_people: groupStats?.total_group_people || 0,
      checked_in: groupStats?.group_checked_in_count || 0
    },
    activity: {
      total: activityStats?.total_registrations || 0,
      checked_in: activityStats?.checked_in_count || 0
    }
  });
});

export const getNoShowRecords = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { user_id, start_date, end_date, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT r.*, v.name as venue_name, u.real_name, u.phone as user_phone
             FROM reservations r
             LEFT JOIN venues v ON r.venue_id = v.id
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.is_no_show = 1`;
  let params: any[] = [];

  if (user_id) {
    sql += ' AND r.user_id = ?';
    params.push(user_id);
  }
  if (start_date) {
    sql += ' AND r.date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND r.date <= ?';
    params.push(end_date);
  }

  const countSql = sql.replace('SELECT r.*, v.name as venue_name, u.real_name, u.phone as user_phone', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY r.date DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});
