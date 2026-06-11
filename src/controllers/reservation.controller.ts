import { Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateReservationNo, generateTicketCode } from '../utils/generator';
import { sendMessage } from '../services/message.service';
import dayjs from 'dayjs';

export const createReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { time_slot_id, visitor_name, visitor_phone, visitor_count, id_card, source } = req.body;

  if (!time_slot_id || !visitor_name || !visitor_phone) {
    throw new ApiError(400, '时段、姓名、手机号为必填项', 'invalid_params');
  }

  if (visitor_count !== undefined && visitor_count !== null) {
    if (typeof visitor_count !== 'number' || !Number.isInteger(visitor_count) || visitor_count <= 0) {
      throw new ApiError(400, `人数不合法：${visitor_count}，必须是正整数`, 'invalid_visitor_count');
    }
    if (visitor_count > 50) {
      throw new ApiError(400, `人数不合法：超过上限(50人)，如需团体预约请走团体通道`, 'invalid_visitor_count');
    }
  }

  const timeSlot = await get('SELECT * FROM time_slots WHERE id = ?', [time_slot_id]);
  if (!timeSlot) {
    throw new ApiError(404, '时段不存在', 'not_found');
  }

  if (timeSlot.status !== 1) {
    throw new ApiError(400, '该时段不可预约', 'invalid_operation');
  }

  const calendarSetting = await get(
    'SELECT is_open, daily_limit FROM calendar_settings WHERE venue_id = ? AND date = ?',
    [timeSlot.venue_id, timeSlot.date]
  );

  if (calendarSetting && calendarSetting.is_open === 0) {
    throw new ApiError(400, '该日期场馆不开放', 'invalid_operation');
  }

  if (calendarSetting && calendarSetting.daily_limit) {
    const dayTotal = await get(
      `SELECT COALESCE(SUM(visitor_count), 0) as total FROM reservations 
       WHERE venue_id = ? AND date = ? AND status != 'cancelled' AND is_waitlist = 0`,
      [timeSlot.venue_id, timeSlot.date]
    );
    const dayGroupTotal = await get(
      `SELECT COALESCE(SUM(total_people), 0) as total FROM group_reservations 
       WHERE venue_id = ? AND date = ? AND status NOT IN ('cancelled', 'rejected') AND audit_status != 'rejected'`,
      [timeSlot.venue_id, timeSlot.date]
    );
    const currentDayCount = (dayTotal?.total || 0) + (dayGroupTotal?.total || 0);
    const actualCount = visitor_count || 1;
    if (currentDayCount + actualCount > calendarSetting.daily_limit) {
      throw new ApiError(400, `该日预约人数已达上限(${calendarSetting.daily_limit}人)，请选择其他日期`, 'daily_limit_exceeded');
    }
  }

  const todayReservations = await get(
    `SELECT COUNT(*) as count FROM reservations 
     WHERE user_id = ? AND date = ? AND status != 'cancelled' AND is_waitlist = 0`,
    [userId, timeSlot.date]
  );

  const maxPerUser = parseInt(process.env.MAX_RESERVATION_PER_USER || '5');
  if (todayReservations && todayReservations.count >= maxPerUser) {
    throw new ApiError(400, `当日最多预约${maxPerUser}次`, 'limit_exceeded');
  }

  const availableQuota = timeSlot.total_quota - timeSlot.reserved_count;
  const actualCount = visitor_count || 1;
  const isWaitlist = availableQuota < actualCount;

  let waitlistPosition: number | null = null;
  if (isWaitlist) {
    const waitlistCount = await get(
      'SELECT COUNT(*) as count FROM reservations WHERE time_slot_id = ? AND is_waitlist = 1 AND status = ?',
      [time_slot_id, 'confirmed']
    );
    waitlistPosition = (waitlistCount?.count || 0) + 1;
  }

  const reservationNo = generateReservationNo('R');
  const ticketCode = generateTicketCode();

  const reservationId = await run(
    `INSERT INTO reservations 
     (reservation_no, user_id, venue_id, time_slot_id, date, visitor_name, visitor_phone, visitor_count, id_card, status, source, is_waitlist, waitlist_position, ticket_code) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      reservationNo,
      userId,
      timeSlot.venue_id,
      time_slot_id,
      timeSlot.date,
      visitor_name,
      visitor_phone,
      actualCount,
      id_card || '',
      'confirmed',
      source || 'web',
      isWaitlist ? 1 : 0,
      waitlistPosition,
      ticketCode
    ]
  );

  if (!isWaitlist) {
    await run(
      'UPDATE time_slots SET reserved_count = reserved_count + ? WHERE id = ?',
      [actualCount, time_slot_id]
    );
  } else {
    await run(
      'UPDATE time_slots SET waitlist_count = waitlist_count + ? WHERE id = ?',
      [actualCount, time_slot_id]
    );
  }

  const reservation = await get('SELECT * FROM reservations WHERE id = ?', [reservationId]);

  const msgTitle = isWaitlist ? '预约候补成功' : '预约成功';
  const msgContent = isWaitlist
    ? `您已成功加入候补队列，候补位次：${waitlistPosition}。如有空位将自动通知您。`
    : `您已成功预约${timeSlot.date} ${timeSlot.start_time}-${timeSlot.end_time}时段。凭票码${ticketCode}入场。`;
  await sendMessage(userId, msgTitle, msgContent, 'system', reservationId, 'reservation');

  successResponse(res, reservation, isWaitlist ? '候补排队成功' : '预约成功');
});

export const getReservationList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT r.*, v.name as venue_name 
             FROM reservations r 
             LEFT JOIN venues v ON r.venue_id = v.id 
             WHERE r.user_id = ?`;
  let params: any[] = [userId];

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }

  const countSql = sql.replace('SELECT r.*, v.name as venue_name', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getReservationDetail = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const reservation = await get(
    `SELECT r.*, v.name as venue_name, v.address as venue_address, 
            ts.start_time, ts.end_time
     FROM reservations r 
     LEFT JOIN venues v ON r.venue_id = v.id
     LEFT JOIN time_slots ts ON r.time_slot_id = ts.id
     WHERE r.id = ? AND r.user_id = ?`,
    [id, userId]
  );

  if (!reservation) {
    throw new ApiError(404, '预约不存在', 'not_found');
  }

  successResponse(res, reservation);
});

export const cancelReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const reservation = await get('SELECT * FROM reservations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!reservation) {
    throw new ApiError(404, '预约不存在', 'not_found');
  }

  if (reservation.status === 'cancelled') {
    throw new ApiError(400, '预约已取消', 'invalid_operation');
  }

  if (reservation.checked_in === 1) {
    throw new ApiError(400, '已签到的预约不能取消', 'invalid_operation');
  }

  await run(
    'UPDATE reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['cancelled', id]
  );

  if (!reservation.is_waitlist) {
    await run(
      'UPDATE time_slots SET reserved_count = reserved_count - ? WHERE id = ?',
      [reservation.visitor_count, reservation.time_slot_id]
    );

    await processWaitlist(reservation.time_slot_id, reservation.visitor_count);
  } else {
    await run(
      'UPDATE time_slots SET waitlist_count = waitlist_count - ? WHERE id = ?',
      [reservation.visitor_count, reservation.time_slot_id]
    );
  }

  await sendMessage(userId, '预约已取消', `您的预约（${reservation.reservation_no}）已取消。`, 'system', Number(id), 'reservation');

  successResponse(res, null, '取消成功');
});

export const rescheduleReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const { new_time_slot_id } = req.body;

  if (!new_time_slot_id) {
    throw new ApiError(400, '请选择新的时段', 'invalid_params');
  }

  const reservation = await get('SELECT * FROM reservations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!reservation) {
    throw new ApiError(404, '预约不存在', 'not_found');
  }

  if (reservation.status !== 'confirmed') {
    throw new ApiError(400, '当前状态不支持改期', 'invalid_operation');
  }

  if (reservation.checked_in === 1) {
    throw new ApiError(400, '已签到的预约不能改期', 'invalid_operation');
  }

  if (reservation.is_waitlist) {
    throw new ApiError(400, '候补预约不支持改期', 'invalid_operation');
  }

  const newTimeSlot = await get('SELECT * FROM time_slots WHERE id = ?', [new_time_slot_id]);
  if (!newTimeSlot) {
    throw new ApiError(404, '新时段不存在', 'not_found');
  }

  if (newTimeSlot.status !== 1) {
    throw new ApiError(400, '该时段不可预约', 'invalid_operation');
  }

  const availableQuota = newTimeSlot.total_quota - newTimeSlot.reserved_count;
  if (availableQuota < reservation.visitor_count) {
    throw new ApiError(400, '新时段名额不足', 'quota_insufficient');
  }

  await run(
    'UPDATE time_slots SET reserved_count = reserved_count - ? WHERE id = ?',
    [reservation.visitor_count, reservation.time_slot_id]
  );

  await run(
    'UPDATE time_slots SET reserved_count = reserved_count + ? WHERE id = ?',
    [reservation.visitor_count, new_time_slot_id]
  );

  const newTicketCode = generateTicketCode();
  await run(
    `UPDATE reservations 
     SET time_slot_id = ?, date = ?, ticket_code = ?, updated_at = CURRENT_TIMESTAMP 
     WHERE id = ?`,
    [new_time_slot_id, newTimeSlot.date, newTicketCode, id]
  );

  await processWaitlist(reservation.time_slot_id, reservation.visitor_count);

  const updated = await get('SELECT * FROM reservations WHERE id = ?', [id]);
  await sendMessage(userId, '改期成功', `您的预约已改期至${newTimeSlot.date} ${newTimeSlot.start_time}-${newTimeSlot.end_time}。新票码：${newTicketCode}`, 'system', Number(id), 'reservation');

  successResponse(res, updated, '改期成功');
});

const processWaitlist = async (timeSlotId: number, releasedCount: number) => {
  const waitlist = await all(
    `SELECT * FROM reservations 
     WHERE time_slot_id = ? AND is_waitlist = 1 AND status = 'confirmed'
     ORDER BY created_at ASC
     LIMIT ?`,
    [timeSlotId, releasedCount]
  );

  for (const item of waitlist) {
    if (releasedCount >= item.visitor_count) {
      await run(
        `UPDATE reservations SET is_waitlist = 0, waitlist_position = NULL, ticket_code = ? WHERE id = ?`,
        [generateTicketCode(), item.id]
      );
      await run(
        'UPDATE time_slots SET reserved_count = reserved_count + ?, waitlist_count = waitlist_count - ? WHERE id = ?',
        [item.visitor_count, item.visitor_count, timeSlotId]
      );

      const timeSlot = await get('SELECT * FROM time_slots WHERE id = ?', [timeSlotId]);
      await sendMessage(
        item.user_id,
        '候补预约成功',
        `您候补的${timeSlot?.date} ${timeSlot?.start_time}-${timeSlot?.end_time}时段已有空位，预约成功！凭票码${item.ticket_code}入场。`,
        'system',
        item.id,
        'reservation'
      );

      releasedCount -= item.visitor_count;
    }
  }

  if (waitlist.length > 0) {
    const remainingWaitlist = await all(
      `SELECT * FROM reservations 
       WHERE time_slot_id = ? AND is_waitlist = 1 AND status = 'confirmed'
       ORDER BY created_at ASC`,
      [timeSlotId]
    );

    for (let i = 0; i < remainingWaitlist.length; i++) {
      await run(
        'UPDATE reservations SET waitlist_position = ? WHERE id = ?',
        [i + 1, remainingWaitlist[i].id]
      );
    }
  }
};

export const getReservationByTicketCode = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_code } = req.params;

  const reservation = await get(
    `SELECT r.*, v.name as venue_name, v.address as venue_address,
            ts.start_time, ts.end_time, u.real_name, u.phone as user_phone
     FROM reservations r
     LEFT JOIN venues v ON r.venue_id = v.id
     LEFT JOIN time_slots ts ON r.time_slot_id = ts.id
     LEFT JOIN users u ON r.user_id = u.id
     WHERE r.ticket_code = ?`,
    [ticket_code]
  );

  if (!reservation) {
    throw new ApiError(404, '票码不存在', 'not_found');
  }

  successResponse(res, reservation);
});

export const checkIn = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_code } = req.body;

  if (!ticket_code) {
    throw new ApiError(400, '票码为必填项', 'invalid_params');
  }

  const reservation = await get('SELECT * FROM reservations WHERE ticket_code = ?', [ticket_code]);
  if (!reservation) {
    throw new ApiError(404, '票码不存在', 'not_found');
  }

  if (reservation.status !== 'confirmed') {
    throw new ApiError(400, '预约状态异常，无法签到', 'invalid_operation');
  }

  if (reservation.is_waitlist) {
    throw new ApiError(400, '候补预约不能签到', 'invalid_operation');
  }

  if (reservation.checked_in === 1) {
    throw new ApiError(400, '已签到，请勿重复操作', 'already_checked_in');
  }

  const today = dayjs().format('YYYY-MM-DD');
  if (reservation.date !== today) {
    throw new ApiError(400, '非今日预约，无法签到', 'invalid_date');
  }

  await run(
    'UPDATE reservations SET checked_in = 1, checkin_time = CURRENT_TIMESTAMP WHERE id = ?',
    [reservation.id]
  );

  const updated = await get('SELECT * FROM reservations WHERE id = ?', [reservation.id]);
  successResponse(res, updated, '签到成功');
});

export const getNoShowList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, pageSize = 20, start_date, end_date } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT r.*, v.name as venue_name, u.real_name, u.phone as user_phone
             FROM reservations r
             LEFT JOIN venues v ON r.venue_id = v.id
             LEFT JOIN users u ON r.user_id = u.id
             WHERE r.is_no_show = 1`;
  let params: any[] = [];

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

export const markNoShow = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const reservation = await get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    throw new ApiError(404, '预约不存在', 'not_found');
  }

  if (reservation.checked_in === 1) {
    throw new ApiError(400, '已签到的预约不能标记为爽约', 'invalid_operation');
  }

  await run(
    'UPDATE reservations SET is_no_show = 1, status = ? WHERE id = ?',
    ['no_show', id]
  );

  await sendMessage(
    reservation.user_id,
    '爽约提醒',
    `您的预约（${reservation.reservation_no}）已被标记为爽约。多次爽约会影响您的预约权限。`,
    'system',
    Number(id),
    'reservation'
  );

  successResponse(res, null, '标记成功');
});
