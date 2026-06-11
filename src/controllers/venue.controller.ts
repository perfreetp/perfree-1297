import { Request, Response } from 'express';
import { all, get, run } from '../database';
import { successResponse, ApiError } from '../utils/response';
import { asyncHandler } from '../utils/response';
import dayjs from 'dayjs';

export const getVenueList = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM venues WHERE 1=1';
  let params: any[] = [];

  if (status !== undefined) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY id ASC';
  const venues = await all(sql, params);
  successResponse(res, venues);
});

export const getVenueDetail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const venue = await get('SELECT * FROM venues WHERE id = ?', [id]);

  if (!venue) {
    throw new ApiError(404, '场馆不存在', 'not_found');
  }

  successResponse(res, venue);
});

export const createVenue = asyncHandler(async (req: Request, res: Response) => {
  const { name, description, capacity, address, open_time, close_time } = req.body;

  if (!name || !capacity) {
    throw new ApiError(400, '场馆名称和容量为必填项', 'invalid_params');
  }

  const id = await run(
    `INSERT INTO venues (name, description, capacity, address, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, description || '', capacity, address || '', open_time || '09:00', close_time || '17:00']
  );

  const venue = await get('SELECT * FROM venues WHERE id = ?', [id]);
  successResponse(res, venue, '场馆创建成功');
});

export const updateVenue = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, description, capacity, address, open_time, close_time, status } = req.body;

  const venue = await get('SELECT * FROM venues WHERE id = ?', [id]);
  if (!venue) {
    throw new ApiError(404, '场馆不存在', 'not_found');
  }

  await run(
    `UPDATE venues SET name = ?, description = ?, capacity = ?, address = ?, open_time = ?, close_time = ?, status = ? WHERE id = ?`,
    [
      name || venue.name,
      description !== undefined ? description : venue.description,
      capacity !== undefined ? capacity : venue.capacity,
      address !== undefined ? address : venue.address,
      open_time || venue.open_time,
      close_time || venue.close_time,
      status !== undefined ? status : venue.status,
      id
    ]
  );

  const updated = await get('SELECT * FROM venues WHERE id = ?', [id]);
  successResponse(res, updated, '场馆更新成功');
});

export const getCalendar = asyncHandler(async (req: Request, res: Response) => {
  const { venue_id, start_date, end_date } = req.query;

  if (!venue_id || !start_date || !end_date) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  const settings = await all(
    `SELECT * FROM calendar_settings WHERE venue_id = ? AND date >= ? AND date <= ? ORDER BY date ASC`,
    [venue_id, start_date, end_date]
  );

  const timeSlots = await all(
    `SELECT * FROM time_slots WHERE venue_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, start_time ASC`,
    [venue_id, start_date, end_date]
  );

  const result: any[] = [];
  let currentDate = dayjs(start_date as string);
  const end = dayjs(end_date as string);

  while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
    const dateStr = currentDate.format('YYYY-MM-DD');
    const setting = settings.find(s => s.date === dateStr);
    const slots = timeSlots.filter(s => s.date === dateStr);

    result.push({
      date: dateStr,
      is_open: setting?.is_open ?? 1,
      is_holiday: setting?.is_holiday ?? 0,
      daily_limit: setting?.daily_limit,
      note: setting?.note || '',
      time_slots: slots
    });

    currentDate = currentDate.add(1, 'day');
  }

  successResponse(res, result);
});

export const setCalendarDay = asyncHandler(async (req: Request, res: Response) => {
  const { venue_id, date, is_open, is_holiday, daily_limit, note } = req.body;

  if (!venue_id || !date) {
    throw new ApiError(400, '场馆ID和日期为必填项', 'invalid_params');
  }

  const existing = await get(
    'SELECT id FROM calendar_settings WHERE venue_id = ? AND date = ?',
    [venue_id, date]
  );

  if (existing) {
    await run(
      `UPDATE calendar_settings SET is_open = ?, is_holiday = ?, daily_limit = ?, note = ? WHERE venue_id = ? AND date = ?`,
      [
        is_open !== undefined ? is_open : 1,
        is_holiday !== undefined ? is_holiday : 0,
        daily_limit !== undefined ? daily_limit : null,
        note !== undefined ? note : '',
        venue_id,
        date
      ]
    );
  } else {
    await run(
      `INSERT INTO calendar_settings (venue_id, date, is_open, is_holiday, daily_limit, note) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        venue_id,
        date,
        is_open !== undefined ? is_open : 1,
        is_holiday !== undefined ? is_holiday : 0,
        daily_limit !== undefined ? daily_limit : null,
        note || ''
      ]
    );
  }

  const result = await get(
    'SELECT * FROM calendar_settings WHERE venue_id = ? AND date = ?',
    [venue_id, date]
  );

  successResponse(res, result, '日历设置成功');
});

export const setTimeSlot = asyncHandler(async (req: Request, res: Response) => {
  const { venue_id, date, start_time, end_time, total_quota, status } = req.body;

  if (!venue_id || !date || !start_time || !end_time || total_quota === undefined) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  const existing = await get(
    'SELECT id, reserved_count FROM time_slots WHERE venue_id = ? AND date = ? AND start_time = ? AND end_time = ?',
    [venue_id, date, start_time, end_time]
  );

  if (total_quota < (existing?.reserved_count || 0)) {
    throw new ApiError(400, '总名额不能小于已预约数量', 'invalid_params');
  }

  if (existing) {
    await run(
      `UPDATE time_slots SET total_quota = ?, status = ? WHERE id = ?`,
      [total_quota, status !== undefined ? status : 1, existing.id]
    );
  } else {
    await run(
      `INSERT INTO time_slots (venue_id, date, start_time, end_time, total_quota, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [venue_id, date, start_time, end_time, total_quota, status !== undefined ? status : 1]
    );
  }

  const result = await get(
    'SELECT * FROM time_slots WHERE venue_id = ? AND date = ? AND start_time = ? AND end_time = ?',
    [venue_id, date, start_time, end_time]
  );

  successResponse(res, result, '时段设置成功');
});

export const batchSetTimeSlots = asyncHandler(async (req: Request, res: Response) => {
  const { venue_id, start_date, end_date, time_slots } = req.body;

  if (!venue_id || !start_date || !end_date || !time_slots || !Array.isArray(time_slots)) {
    throw new ApiError(400, '缺少必要参数', 'invalid_params');
  }

  let currentDate = dayjs(start_date);
  const end = dayjs(end_date);
  let count = 0;

  while (currentDate.isBefore(end) || currentDate.isSame(end, 'day')) {
    const dateStr = currentDate.format('YYYY-MM-DD');

    for (const slot of time_slots) {
      const existing = await get(
        'SELECT id, reserved_count FROM time_slots WHERE venue_id = ? AND date = ? AND start_time = ? AND end_time = ?',
        [venue_id, dateStr, slot.start_time, slot.end_time]
      );

      if (existing) {
        if (slot.total_quota >= existing.reserved_count) {
          await run(
            `UPDATE time_slots SET total_quota = ?, status = ? WHERE id = ?`,
            [slot.total_quota, slot.status !== undefined ? slot.status : 1, existing.id]
          );
        }
      } else {
        await run(
          `INSERT INTO time_slots (venue_id, date, start_time, end_time, total_quota, status) VALUES (?, ?, ?, ?, ?, ?)`,
          [venue_id, dateStr, slot.start_time, slot.end_time, slot.total_quota, slot.status !== undefined ? slot.status : 1]
        );
      }
      count++;
    }

    currentDate = currentDate.add(1, 'day');
  }

  successResponse(res, { count }, '批量设置时段成功');
});

export const deleteTimeSlot = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const slot = await get('SELECT reserved_count FROM time_slots WHERE id = ?', [id]);
  if (!slot) {
    throw new ApiError(404, '时段不存在', 'not_found');
  }

  if (slot.reserved_count > 0) {
    throw new ApiError(400, '该时段已有预约，无法删除', 'invalid_operation');
  }

  await run('DELETE FROM time_slots WHERE id = ?', [id]);
  successResponse(res, null, '时段删除成功');
});
