import 'dotenv/config';
import db, { run, get, all, exec } from './index';
import bcrypt from 'bcryptjs';

const createTables = () => {
  console.log('开始创建数据库表...');

  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      real_name TEXT,
      phone TEXT,
      id_card TEXT,
      role TEXT DEFAULT 'user',
      avatar TEXT,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      capacity INTEGER NOT NULL,
      address TEXT,
      open_time TEXT,
      close_time TEXT,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS calendar_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      is_open INTEGER DEFAULT 1,
      is_holiday INTEGER DEFAULT 0,
      daily_limit INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(venue_id, date)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS time_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      total_quota INTEGER NOT NULL,
      reserved_count INTEGER DEFAULT 0,
      waitlist_count INTEGER DEFAULT 0,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(venue_id, date, start_time, end_time)
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      venue_id INTEGER NOT NULL,
      time_slot_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      visitor_name TEXT NOT NULL,
      visitor_phone TEXT NOT NULL,
      visitor_count INTEGER DEFAULT 1,
      id_card TEXT,
      status TEXT DEFAULT 'confirmed',
      source TEXT DEFAULT 'web',
      is_waitlist INTEGER DEFAULT 0,
      waitlist_position INTEGER,
      ticket_code TEXT UNIQUE,
      checked_in INTEGER DEFAULT 0,
      checkin_time DATETIME,
      is_no_show INTEGER DEFAULT 0,
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS group_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_no TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL,
      venue_id INTEGER NOT NULL,
      time_slot_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      group_name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      total_people INTEGER NOT NULL,
      member_list TEXT,
      status TEXT DEFAULT 'pending',
      source TEXT DEFAULT 'web',
      ticket_code TEXT UNIQUE,
      checked_in_count INTEGER DEFAULT 0,
      checkin_time DATETIME,
      remark TEXT,
      audit_status TEXT DEFAULT 'pending',
      audit_by INTEGER,
      audit_time DATETIME,
      audit_remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      cover_image TEXT,
      venue_id INTEGER,
      category TEXT,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      registration_start DATETIME NOT NULL,
      registration_end DATETIME NOT NULL,
      max_participants INTEGER,
      registered_count INTEGER DEFAULT 0,
      waitlist_count INTEGER DEFAULT 0,
      fee REAL DEFAULT 0,
      is_member_only INTEGER DEFAULT 0,
      points_required INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      audit_status TEXT DEFAULT 'pending',
      audit_by INTEGER,
      audit_time DATETIME,
      audit_remark TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS activity_registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_no TEXT UNIQUE NOT NULL,
      activity_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      id_card TEXT,
      participant_count INTEGER DEFAULT 1,
      questionnaire_data TEXT,
      status TEXT DEFAULT 'registered',
      is_waitlist INTEGER DEFAULT 0,
      waitlist_position INTEGER,
      ticket_code TEXT UNIQUE,
      checked_in INTEGER DEFAULT 0,
      checkin_time DATETIME,
      points_awarded INTEGER DEFAULT 0,
      source TEXT DEFAULT 'web',
      remark TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS questionnaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      questions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      member_no TEXT UNIQUE NOT NULL,
      member_level TEXT DEFAULT 'normal',
      points INTEGER DEFAULT 0,
      total_points INTEGER DEFAULT 0,
      join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      expire_date DATETIME,
      status INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS point_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      points INTEGER NOT NULL,
      type TEXT NOT NULL,
      reason TEXT,
      related_id INTEGER,
      related_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'system',
      is_read INTEGER DEFAULT 0,
      read_time DATETIME,
      related_id INTEGER,
      related_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id INTEGER,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      before_data TEXT,
      after_data TEXT,
      remark TEXT,
      ip TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      module TEXT,
      params TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      source TEXT DEFAULT 'web',
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('数据库表创建完成');
};

const seedData = () => {
  const adminExists = get("SELECT id FROM users WHERE username = 'admin'");
  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    run(
      `INSERT INTO users (username, password, real_name, phone, role) VALUES (?, ?, ?, ?, ?)`,
      ['admin', hashedPassword, '系统管理员', '13800138000', 'admin']
    );
    console.log('创建管理员账号: admin / admin123');
  }

  const staffExists = get("SELECT id FROM users WHERE username = 'staff'");
  if (!staffExists) {
    const hashedPassword = bcrypt.hashSync('staff123', 10);
    run(
      `INSERT INTO users (username, password, real_name, phone, role) VALUES (?, ?, ?, ?, ?)`,
      ['staff', hashedPassword, '前台工作人员', '13800138001', 'staff']
    );
    console.log('创建工作人员账号: staff / staff123');
  }

  const venues = all('SELECT id FROM venues');
  if (venues.length === 0) {
    run(
      `INSERT INTO venues (name, description, capacity, address, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?)`,
      ['主展厅', '数字文化主展厅，展示各类数字文化作品', 200, '一楼A区', '09:00', '17:00']
    );
    run(
      `INSERT INTO venues (name, description, capacity, address, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?)`,
      ['多功能厅', '可举办各类文化活动和培训课程', 100, '二楼B区', '09:00', '21:00']
    );
    run(
      `INSERT INTO venues (name, description, capacity, address, open_time, close_time) VALUES (?, ?, ?, ?, ?, ?)`,
      ['VR体验区', '沉浸式VR数字文化体验', 30, '三楼C区', '10:00', '18:00']
    );
    console.log('创建3个场馆');

    const venueIds = all('SELECT id FROM venues ORDER BY id ASC');
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayOfWeek = date.getDay();

      if (dayOfWeek !== 1) {
        for (const v of venueIds) {
          const venue = get('SELECT * FROM venues WHERE id = ?', [v.id]);
          const openHour = parseInt(venue!.open_time.split(':')[0]);
          const closeHour = parseInt(venue!.close_time.split(':')[0]);
          const slots = Math.floor((closeHour - openHour) / 2);

          for (let j = 0; j < slots; j++) {
            const startHour = openHour + j * 2;
            const endHour = startHour + 2;
            run(
              `INSERT INTO time_slots (venue_id, date, start_time, end_time, total_quota, status) 
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                v.id,
                dateStr,
                `${startHour.toString().padStart(2, '0')}:00`,
                `${endHour.toString().padStart(2, '0')}:00`,
                Math.floor(venue!.capacity / 2),
                1
              ]
            );
          }
        }
      }
    }
    console.log('创建未来14天的时段数据');
  }
};

const init = () => {
  try {
    createTables();
    seedData();
    console.log('数据库初始化成功！');
    process.exit(0);
  } catch (err) {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  }
};

init();
