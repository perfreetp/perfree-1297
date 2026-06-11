import { Request, Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError, asyncHandler } from '../utils/response';
import { AuthRequest } from '../middlewares/auth.middleware';
import { generateReservationNo, generateTicketCode } from '../utils/generator';
import { sendMessage } from '../services/message.service';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';

export const createActivity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const {
    title,
    description,
    cover_image,
    venue_id,
    category,
    start_time,
    end_time,
    registration_start,
    registration_end,
    max_participants,
    fee,
    is_member_only,
    points_required
  } = req.body;

  if (!title || !start_time || !end_time || !registration_start || !registration_end) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  const id = await run(
    `INSERT INTO activities 
     (title, description, cover_image, venue_id, category, start_time, end_time, 
      registration_start, registration_end, max_participants, fee, is_member_only, 
      points_required, created_by, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      description || '',
      cover_image || '',
      venue_id || null,
      category || '',
      start_time,
      end_time,
      registration_start,
      registration_end,
      max_participants || null,
      fee || 0,
      is_member_only ? 1 : 0,
      points_required || 0,
      userId,
      'draft'
    ]
  );

  const activity = await get('SELECT * FROM activities WHERE id = ?', [id]);
  successResponse(res, activity, '活动创建成功');
});

export const getActivityList = asyncHandler(async (req: Request, res: Response) => {
  const { status, category, page = 1, pageSize = 20, is_recommend } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT a.*, v.name as venue_name 
             FROM activities a 
             LEFT JOIN venues v ON a.venue_id = v.id 
             WHERE 1=1`;
  let params: any[] = [];

  if (status) {
    sql += ' AND a.status = ?';
    params.push(status);
  }
  if (category) {
    sql += ' AND a.category = ?';
    params.push(category);
  }

  const countSql = sql.replace('SELECT a.*, v.name as venue_name', 'SELECT COUNT(*) as count');
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY a.start_time DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getActivityDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const activity = await get(
    `SELECT a.*, v.name as venue_name, v.address as venue_address, v.capacity as venue_capacity
     FROM activities a
     LEFT JOIN venues v ON a.venue_id = v.id
     WHERE a.id = ?`,
    [id]
  );

  if (!activity) {
    throw new ApiError(404, '活动不存在', 'not_found');
  }

  const questionaire = await get(
    'SELECT * FROM questionnaires WHERE activity_id = ?',
    [id]
  );
  if (questionaire && questionaire.questions) {
    questionaire.questions = JSON.parse(questionaire.questions);
  }

  successResponse(res, { ...activity, questionaire });
});

export const updateActivity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const {
    title,
    description,
    cover_image,
    venue_id,
    category,
    start_time,
    end_time,
    registration_start,
    registration_end,
    max_participants,
    fee,
    is_member_only,
    points_required,
    status
  } = req.body;

  const activity = await get('SELECT * FROM activities WHERE id = ?', [id]);
  if (!activity) {
    throw new ApiError(404, '活动不存在', 'not_found');
  }

  await run(
    `UPDATE activities SET 
       title = ?, description = ?, cover_image = ?, venue_id = ?, category = ?,
       start_time = ?, end_time = ?, registration_start = ?, registration_end = ?,
       max_participants = ?, fee = ?, is_member_only = ?, points_required = ?,
       status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      title || activity.title,
      description !== undefined ? description : activity.description,
      cover_image !== undefined ? cover_image : activity.cover_image,
      venue_id !== undefined ? venue_id : activity.venue_id,
      category !== undefined ? category : activity.category,
      start_time || activity.start_time,
      end_time || activity.end_time,
      registration_start || activity.registration_start,
      registration_end || activity.registration_end,
      max_participants !== undefined ? max_participants : activity.max_participants,
      fee !== undefined ? fee : activity.fee,
      is_member_only !== undefined ? (is_member_only ? 1 : 0) : activity.is_member_only,
      points_required !== undefined ? points_required : activity.points_required,
      status || activity.status,
      id
    ]
  );

  const updated = await get('SELECT * FROM activities WHERE id = ?', [id]);
  successResponse(res, updated, '活动更新成功');
});

export const registerActivity = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { activity_id, name, phone, id_card, participant_count, questionnaire_data, source } = req.body;

  if (!activity_id || !name || !phone) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  if (participant_count !== undefined && participant_count !== null) {
    if (typeof participant_count !== 'number' || !Number.isInteger(participant_count) || participant_count <= 0) {
      throw new ApiError(400, `人数不合法：${participant_count}，必须是正整数`, 'invalid_participant_count');
    }
    if (participant_count > 200) {
      throw new ApiError(400, `人数不合法：超过上限(200人)`, 'invalid_participant_count');
    }
  }

  const activity = await get('SELECT * FROM activities WHERE id = ?', [activity_id]);
  if (!activity) {
    throw new ApiError(404, '活动不存在', 'not_found');
  }

  if (activity.status !== 'published' && activity.audit_status !== 'approved') {
    throw new ApiError(400, '活动未发布，不能报名', 'invalid_operation');
  }

  const now = dayjs();
  if (now.isBefore(dayjs(activity.registration_start))) {
    throw new ApiError(400, '报名尚未开始', 'registration_not_started');
  }
  if (now.isAfter(dayjs(activity.registration_end))) {
    throw new ApiError(400, '报名已结束', 'registration_ended');
  }

  const existingRegistration = await get(
    'SELECT id FROM activity_registrations WHERE activity_id = ? AND user_id = ? AND status != ?',
    [activity_id, userId, 'cancelled']
  );
  if (existingRegistration) {
    throw new ApiError(400, '您已报名该活动', 'already_registered');
  }

  if (activity.is_member_only) {
    const member = await get('SELECT id FROM members WHERE user_id = ? AND status = 1', [userId]);
    if (!member) {
      throw new ApiError(400, '该活动仅限会员参加', 'member_only');
    }
  }

  const actualCount = participant_count || 1;
  const remainingQuota = activity.max_participants ? activity.max_participants - activity.registered_count : null;
  const isWaitlist = remainingQuota !== null && remainingQuota < actualCount;

  let waitlistPosition: number | null = null;
  if (isWaitlist) {
    const waitlistCount = await get(
      'SELECT COUNT(*) as count FROM activity_registrations WHERE activity_id = ? AND is_waitlist = 1 AND status = ?',
      [activity_id, 'registered']
    );
    waitlistPosition = (waitlistCount?.count || 0) + 1;
  }

  const registrationNo = generateReservationNo('A');
  const ticketCode = generateTicketCode();

  const registrationId = await run(
    `INSERT INTO activity_registrations 
     (registration_no, activity_id, user_id, name, phone, id_card, participant_count, 
      questionnaire_data, status, is_waitlist, waitlist_position, ticket_code, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      registrationNo,
      activity_id,
      userId,
      name,
      phone,
      id_card || '',
      actualCount,
      questionnaire_data ? JSON.stringify(questionnaire_data) : null,
      'registered',
      isWaitlist ? 1 : 0,
      waitlistPosition,
      ticketCode,
      source || 'web'
    ]
  );

  if (!isWaitlist) {
    await run(
      'UPDATE activities SET registered_count = registered_count + ? WHERE id = ?',
      [actualCount, activity_id]
    );
  } else {
    await run(
      'UPDATE activities SET waitlist_count = waitlist_count + ? WHERE id = ?',
      [actualCount, activity_id]
    );
  }

  const registration = await get('SELECT * FROM activity_registrations WHERE id = ?', [registrationId]);

  const msgTitle = isWaitlist ? '活动候补成功' : '活动报名成功';
  const msgContent = isWaitlist
    ? `您已成功加入《${activity.title}》候补队列，候补位次：${waitlistPosition}。`
    : `您已成功报名《${activity.title}》。凭票码${ticketCode}参加活动。`;
  await sendMessage(userId, msgTitle, msgContent, 'system', registrationId, 'activity');

  successResponse(res, registration, isWaitlist ? '候补排队成功' : '报名成功');
});

export const getMyRegistrations = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT ar.*, a.title as activity_title, a.start_time, a.end_time, 
                    a.cover_image, a.category, v.name as venue_name
             FROM activity_registrations ar
             LEFT JOIN activities a ON ar.activity_id = a.id
             LEFT JOIN venues v ON a.venue_id = v.id
             WHERE ar.user_id = ?`;
  let params: any[] = [userId];

  if (status) {
    sql += ' AND ar.status = ?';
    params.push(status);
  }

  const countSql = sql.replace(
    'SELECT ar.*, a.title as activity_title, a.start_time, a.end_time, a.cover_image, a.category, v.name as venue_name',
    'SELECT COUNT(*) as count'
  );
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY ar.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const getRegistrationDetail = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const registration = await get(
    `SELECT ar.*, a.title as activity_title, a.description as activity_description,
            a.start_time, a.end_time, v.name as venue_name, v.address as venue_address
     FROM activity_registrations ar
     LEFT JOIN activities a ON ar.activity_id = a.id
     LEFT JOIN venues v ON a.venue_id = v.id
     WHERE ar.id = ? AND ar.user_id = ?`,
    [id, userId]
  );

  if (!registration) {
    throw new ApiError(404, '报名记录不存在', 'not_found');
  }

  if (registration.questionnaire_data) {
    registration.questionnaire_data = JSON.parse(registration.questionnaire_data);
  }

  successResponse(res, registration);
});

export const cancelRegistration = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const registration = await get('SELECT * FROM activity_registrations WHERE id = ? AND user_id = ?', [id, userId]);
  if (!registration) {
    throw new ApiError(404, '报名记录不存在', 'not_found');
  }

  if (registration.status === 'cancelled') {
    throw new ApiError(400, '已取消，请勿重复操作', 'invalid_operation');
  }

  if (registration.checked_in === 1) {
    throw new ApiError(400, '已签到的报名不能取消', 'invalid_operation');
  }

  await run(
    'UPDATE activity_registrations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['cancelled', id]
  );

  if (!registration.is_waitlist) {
    await run(
      'UPDATE activities SET registered_count = registered_count - ? WHERE id = ?',
      [registration.participant_count, registration.activity_id]
    );

    await processActivityWaitlist(registration.activity_id, registration.participant_count);
  } else {
    await run(
      'UPDATE activities SET waitlist_count = waitlist_count - ? WHERE id = ?',
      [registration.participant_count, registration.activity_id]
    );
  }

  const activity = await get('SELECT title FROM activities WHERE id = ?', [registration.activity_id]);
  await sendMessage(userId, '活动报名已取消', `您的《${activity?.title}》报名已取消。`, 'system', Number(id), 'activity');

  successResponse(res, null, '取消成功');
});

const processActivityWaitlist = async (activityId: number, releasedCount: number) => {
  const waitlist = await all(
    `SELECT * FROM activity_registrations 
     WHERE activity_id = ? AND is_waitlist = 1 AND status = 'registered'
     ORDER BY created_at ASC
     LIMIT ?`,
    [activityId, releasedCount]
  );

  for (const item of waitlist) {
    if (releasedCount >= item.participant_count) {
      await run(
        `UPDATE activity_registrations SET is_waitlist = 0, waitlist_position = NULL, ticket_code = ? WHERE id = ?`,
        [generateTicketCode(), item.id]
      );
      await run(
        'UPDATE activities SET registered_count = registered_count + ?, waitlist_count = waitlist_count - ? WHERE id = ?',
        [item.participant_count, item.participant_count, activityId]
      );

      const activity = await get('SELECT title FROM activities WHERE id = ?', [activityId]);
      await sendMessage(
        item.user_id,
        '活动候补成功',
        `您候补的《${activity?.title}》已有空位，报名成功！`,
        'system',
        item.id,
        'activity'
      );

      releasedCount -= item.participant_count;
    }
  }

  if (waitlist.length > 0) {
    const remainingWaitlist = await all(
      `SELECT * FROM activity_registrations 
       WHERE activity_id = ? AND is_waitlist = 1 AND status = 'registered'
       ORDER BY created_at ASC`,
      [activityId]
    );

    for (let i = 0; i < remainingWaitlist.length; i++) {
      await run(
        'UPDATE activity_registrations SET waitlist_position = ? WHERE id = ?',
        [i + 1, remainingWaitlist[i].id]
      );
    }
  }
};

export const setQuestionnaire = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { activity_id, title, questions } = req.body;

  if (!activity_id || !questions) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  const existing = await get('SELECT id FROM questionnaires WHERE activity_id = ?', [activity_id]);

  if (existing) {
    await run(
      'UPDATE questionnaires SET title = ?, questions = ? WHERE activity_id = ?',
      [title || '活动问卷', JSON.stringify(questions), activity_id]
    );
  } else {
    await run(
      'INSERT INTO questionnaires (activity_id, title, questions) VALUES (?, ?, ?)',
      [activity_id, title || '活动问卷', JSON.stringify(questions)]
    );
  }

  const questionnaire = await get('SELECT * FROM questionnaires WHERE activity_id = ?', [activity_id]);
  if (questionnaire && questionnaire.questions) {
    questionnaire.questions = JSON.parse(questionnaire.questions);
  }

  successResponse(res, questionnaire, '问卷设置成功');
});

export const getQuestionnaire = asyncHandler(async (req: Request, res: Response) => {
  const { activity_id } = req.params;

  const questionnaire = await get('SELECT * FROM questionnaires WHERE activity_id = ?', [activity_id]);
  if (questionnaire && questionnaire.questions) {
    questionnaire.questions = JSON.parse(questionnaire.questions);
  }

  successResponse(res, questionnaire);
});

export const getRegistrationList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { activity_id, status, page = 1, pageSize = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(pageSize);

  let sql = `SELECT ar.*, a.title as activity_title, u.real_name, u.phone as user_phone
             FROM activity_registrations ar
             LEFT JOIN activities a ON ar.activity_id = a.id
             LEFT JOIN users u ON ar.user_id = u.id
             WHERE 1=1`;
  let params: any[] = [];

  if (activity_id) {
    sql += ' AND ar.activity_id = ?';
    params.push(activity_id);
  }
  if (status) {
    sql += ' AND ar.status = ?';
    params.push(status);
  }

  const countSql = sql.replace(
    'SELECT ar.*, a.title as activity_title, u.real_name, u.phone as user_phone',
    'SELECT COUNT(*) as count'
  );
  const totalResult = await get(countSql, params);
  const total = totalResult?.count || 0;

  sql += ' ORDER BY ar.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(pageSize), offset);

  const list = await all(sql, params);

  successResponse(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
});

export const exportRegistrationList = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { activity_id } = req.query;

  if (!activity_id) {
    throw new ApiError(400, '活动ID为必填项', 'invalid_params');
  }

  const registrations = await all(
    `SELECT ar.registration_no, ar.name, ar.phone, ar.id_card, ar.participant_count,
            ar.status, ar.checked_in, ar.checkin_time, ar.created_at, ar.questionnaire_data
     FROM activity_registrations ar
     WHERE ar.activity_id = ?
     ORDER BY ar.created_at ASC`,
    [activity_id]
  );

  const exportData = registrations.map(r => {
    let questionnaireStr = '';
    if (r.questionnaire_data) {
      try {
        const q = JSON.parse(r.questionnaire_data);
        questionnaireStr = Object.entries(q).map(([k, v]) => `${k}: ${v}`).join('; ');
      } catch (e) {
        questionnaireStr = r.questionnaire_data;
      }
    }

    return {
      '报名编号': r.registration_no,
      '姓名': r.name,
      '手机号': r.phone,
      '身份证号': r.id_card || '',
      '人数': r.participant_count,
      '状态': r.status === 'registered' ? '已报名' : r.status === 'cancelled' ? '已取消' : r.status,
      '是否签到': r.checked_in ? '是' : '否',
      '签到时间': r.checkin_time || '',
      '报名时间': r.created_at,
      '问卷信息': questionnaireStr
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '报名名单');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  const activity = await get('SELECT title FROM activities WHERE id = ?', [activity_id]);
  const fileName = encodeURIComponent(`${activity?.title || '活动'}_报名名单.xlsx`);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
});


