import { Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateReservationNo, generateTicketCode } from '../utils/generator';
import { sendMessage } from '../services/message.service';

export const createGroupReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const {
    time_slot_id,
    group_name,
    contact_person,
    contact_phone,
    total_people,
    member_list,
    source
  } = req.body;

  if (!time_slot_id || !group_name || !contact_person || !contact_phone || !total_people) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  if (total_people < 5) {
    throw new ApiError(400, '团体预约至少需要5人', 'invalid_params');
  }

  const timeSlot = await get('SELECT * FROM time_slots WHERE id = ?', [time_slot_id]);
  if (!timeSlot) {
    throw new ApiError(404, '时段不存在', 'not_found');
  }

  if (timeSlot.status !== 1) {
    throw new ApiError(400, '该时段不可预约', 'invalid_operation');
  }

  const availableQuota = timeSlot.total_quota - timeSlot.reserved_count - timeSlot.waitlist_count;
  if (availableQuota < total_people) {
    throw new ApiError(400, '该时段名额不足，请选择其他时段', 'quota_insufficient');
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
    if (currentDayCount + total_people > calendarSetting.daily_limit) {
      throw new ApiError(400, `该日预约人数已达上限(${calendarSetting.daily_limit}人)，请选择其他日期`, 'daily_limit_exceeded');
    }
  }

  const groupNo = generateReservationNo('G');
  const ticketCode = generateTicketCode();

  const groupId = await run(
    `INSERT INTO group_reservations 
     (group_no, user_id, venue_id, time_slot_id, date, group_name, contact_person, 
      contact_phone, total_people, member_list, status, source, ticket_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      groupNo,
      userId,
      timeSlot.venue_id,
      time_slot_id,
      timeSlot.date,
      group_name,
      contact_person,
      contact_phone,
      total_people,
      member_list ? JSON.stringify(member_list) : null,
      'pending',
      source || 'web',
      ticketCode
    ]
  );

  await run(
    'UPDATE time_slots SET reserved_count = reserved_count + ? WHERE id = ?',
    [total_people, time_slot_id]
  );

  const groupReservation = await get('SELECT * FROM group_reservations WHERE id = ?', [groupId]);
  await sendMessage(userId, '团体预约提交成功', `您的团体预约（${groupNo}）已提交，等待审核。`, 'system', groupId, 'group_reservation');

  successResponse(res, groupReservation, '团体预约提交成功，等待审核');
});

export const getGroupReservationList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { status, page = 1, pageSize = 20, audit_status } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT gr.*, v.name as venue_name 
             FROM group_reservations gr 
             LEFT JOIN venues v ON gr.venue_id = v.id 
             WHERE gr.user_id = ?`;
  let params: any[] = [userId];

  if (status) {
    sql += ' AND gr.status = ?';
    params.push(status);
  }
  if (audit_status) {
    sql += ' AND gr.audit_status = ?';
    params.push(audit_status);
  }

  const countSql = sql.replace('SELECT gr.*, v.name as venue_name', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY gr.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getGroupReservationDetail = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const groupReservation = await get(
    `SELECT gr.*, v.name as venue_name, v.address as venue_address,
            ts.start_time, ts.end_time
     FROM group_reservations gr
     LEFT JOIN venues v ON gr.venue_id = v.id
     LEFT JOIN time_slots ts ON gr.time_slot_id = ts.id
     WHERE gr.id = ? AND gr.user_id = ?`,
    [id, userId]
  );

  if (!groupReservation) {
    throw new ApiError(404, '团体预约不存在', 'not_found');
  }

  if (groupReservation.member_list) {
    groupReservation.member_list = JSON.parse(groupReservation.member_list);
  }

  successResponse(res, groupReservation);
});

export const cancelGroupReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const groupReservation = await get('SELECT * FROM group_reservations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!groupReservation) {
    throw new ApiError(404, '团体预约不存在', 'not_found');
  }

  if (groupReservation.status === 'cancelled') {
    throw new ApiError(400, '预约已取消', 'invalid_operation');
  }

  if (groupReservation.status === 'rejected') {
    throw new ApiError(400, '预约已被驳回，无需取消', 'invalid_operation');
  }

  if (groupReservation.checkin_time) {
    throw new ApiError(400, '已签到的预约不能取消', 'invalid_operation');
  }

  await run(
    'UPDATE group_reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['cancelled', id]
  );

  if (groupReservation.audit_status !== 'rejected') {
    await run(
      'UPDATE time_slots SET reserved_count = reserved_count - ? WHERE id = ?',
      [groupReservation.total_people, groupReservation.time_slot_id]
    );
  }

  await sendMessage(userId, '团体预约已取消', `您的团体预约（${groupReservation.group_no}）已取消。`, 'system', Number(id), 'group_reservation');

  successResponse(res, null, '取消成功');
});

export const auditGroupReservation = asyncHandler(async (req: AuthRequest, res: Response) => {
  const operatorId = req.user!.id;
  const { id } = req.params;
  const { audit_status, audit_remark } = req.body;

  if (!audit_status || !['approved', 'rejected'].includes(audit_status)) {
    throw new ApiError(400, '审核状态无效', 'invalid_params');
  }

  const groupReservation = await get('SELECT * FROM group_reservations WHERE id = ?', [id]);
  if (!groupReservation) {
    throw new ApiError(404, '团体预约不存在', 'not_found');
  }

  if (groupReservation.audit_status !== 'pending') {
    throw new ApiError(400, '该预约已审核，请勿重复操作', 'invalid_operation');
  }

  if (audit_status === 'approved') {
    await run(
      `UPDATE group_reservations 
       SET audit_status = ?, audit_by = ?, audit_time = CURRENT_TIMESTAMP, 
           audit_remark = ?, status = 'confirmed', updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [audit_status, operatorId, audit_remark || '', id]
    );

    await sendMessage(
      groupReservation.user_id,
      '团体预约审核通过',
      `您的团体预约（${groupReservation.group_no}）已审核通过。凭票码${groupReservation.ticket_code}入场。`,
      'system',
      Number(id),
      'group_reservation'
    );
  } else {
    await run(
      'UPDATE time_slots SET reserved_count = reserved_count - ? WHERE id = ?',
      [groupReservation.total_people, groupReservation.time_slot_id]
    );

    await run(
      `UPDATE group_reservations 
       SET audit_status = ?, audit_by = ?, audit_time = CURRENT_TIMESTAMP, 
           audit_remark = ?, status = 'rejected', updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [audit_status, operatorId, audit_remark || '', id]
    );

    await sendMessage(
      groupReservation.user_id,
      '团体预约审核未通过',
      `您的团体预约（${groupReservation.group_no}）审核未通过。原因：${audit_remark || '无'}`,
      'system',
      Number(id),
      'group_reservation'
    );
  }

  const updated = await get('SELECT * FROM group_reservations WHERE id = ?', [id]);
  successResponse(res, updated, '审核完成');
});

export const getAdminGroupList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, audit_status, page = 1, pageSize = 20, start_date, end_date } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT gr.*, v.name as venue_name, u.real_name, u.phone as user_phone
             FROM group_reservations gr
             LEFT JOIN venues v ON gr.venue_id = v.id
             LEFT JOIN users u ON gr.user_id = u.id
             WHERE 1=1`;
  let params: any[] = [];

  if (status) {
    sql += ' AND gr.status = ?';
    params.push(status);
  }
  if (audit_status) {
    sql += ' AND gr.audit_status = ?';
    params.push(audit_status);
  }
  if (start_date) {
    sql += ' AND gr.date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND gr.date <= ?';
    params.push(end_date);
  }

  const countSql = sql.replace('SELECT gr.*, v.name as venue_name, u.real_name, u.phone as user_phone', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY gr.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const groupCheckIn = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ticket_code, checkin_count } = req.body;

  if (!ticket_code) {
    throw new ApiError(400, '票码为必填项', 'invalid_params');
  }

  const groupReservation = await get('SELECT * FROM group_reservations WHERE ticket_code = ?', [ticket_code]);
  if (!groupReservation) {
    throw new ApiError(404, '票码不存在', 'not_found');
  }

  if (groupReservation.audit_status !== 'approved' && groupReservation.status !== 'confirmed') {
    throw new ApiError(400, '预约审核未通过，无法签到', 'invalid_operation');
  }

  if (groupReservation.status === 'cancelled') {
    throw new ApiError(400, '预约已取消', 'invalid_operation');
  }

  const actualCount = checkin_count || groupReservation.total_people;
  const newCheckedInCount = (groupReservation.checked_in_count || 0) + actualCount;

  if (newCheckedInCount > groupReservation.total_people) {
    throw new ApiError(400, '签到人数超过预约人数', 'invalid_params');
  }

  await run(
    `UPDATE group_reservations 
     SET checked_in_count = ?, checkin_time = CASE WHEN checkin_time IS NULL THEN CURRENT_TIMESTAMP ELSE checkin_time END 
     WHERE id = ?`,
    [newCheckedInCount, groupReservation.id]
  );

  const updated = await get('SELECT * FROM group_reservations WHERE id = ?', [groupReservation.id]);
  successResponse(res, updated, '签到成功');
});

export const importGroupMembers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { members } = req.body;

  if (!members || !Array.isArray(members) || members.length === 0) {
    throw new ApiError(400, '成员列表不能为空', 'invalid_params');
  }

  const groupReservation = await get('SELECT * FROM group_reservations WHERE id = ? AND user_id = ?', [id, req.user!.id]);
  if (!groupReservation) {
    throw new ApiError(404, '团体预约不存在', 'not_found');
  }

  const memberList = JSON.stringify(members);
  await run(
    'UPDATE group_reservations SET member_list = ?, total_people = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [memberList, members.length, id]
  );

  const updated = await get('SELECT * FROM group_reservations WHERE id = ?', [id]);
  if (updated && updated.member_list) {
    updated.member_list = JSON.parse(updated.member_list);
  }

  successResponse(res, updated, '导入成功');
});
