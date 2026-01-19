import * as sql from 'mssql';
import { 
  Division, 
  RecruiterConfig, 
  IncludedRegion, 
  ReportRow,
  WeeklyTotals,
  CreateRecruiterRequest,
  UpdateRecruiterRequest,
  CreateDivisionRequest,
  UpdateDivisionRequest
} from '../types';

class DatabaseService {
  private pool: sql.ConnectionPool | null = null;
  private ctmsyncPool: sql.ConnectionPool | null = null;
  private config: sql.config;
  private ctmsyncConfig: sql.config;

  constructor() {
    // Main hours_report database
    this.config = {
      server: process.env.SQL_SERVER || '',
      database: process.env.SQL_DATABASE || 'hours_report',
      user: process.env.SQL_USER || '',
      password: process.env.SQL_PASSWORD || '',
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };
    
    // ghr_ctmsync database (read-only mirror of ATS)
    this.ctmsyncConfig = {
      server: process.env.SQL_SERVER || '',
      database: process.env.SQL_DATABASE_CTMSYNC || 'ghr_ctmsync',
      user: process.env.SQL_USER || '',
      password: process.env.SQL_PASSWORD || '',
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };
  }

  async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await sql.connect(this.config);
    }
    return this.pool;
  }

  async getCtmsyncPool(): Promise<sql.ConnectionPool> {
    if (!this.ctmsyncPool) {
      this.ctmsyncPool = await new sql.ConnectionPool(this.ctmsyncConfig).connect();
    }
    return this.ctmsyncPool;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
    if (this.ctmsyncPool) {
      await this.ctmsyncPool.close();
      this.ctmsyncPool = null;
    }
  }

  // DIVISIONS

  async getDivisions(includeInactive = false): Promise<Division[]> {
    const pool = await this.getPool();
    const query = includeInactive
      ? 'SELECT * FROM dbo.divisions ORDER BY display_order'
      : 'SELECT * FROM dbo.divisions WHERE is_active = 1 ORDER BY display_order';
    
    const result = await pool.request().query(query);
    return result.recordset;
  }

  async getDivisionById(divisionId: number): Promise<Division | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('divisionId', sql.Int, divisionId)
      .query('SELECT * FROM dbo.divisions WHERE division_id = @divisionId');
    
    return result.recordset[0] || null;
  }

  async createDivision(data: CreateDivisionRequest): Promise<Division> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('divisionName', sql.NVarChar(100), data.division_name)
      .input('displayOrder', sql.Int, data.display_order || 0)
      .query(`
        INSERT INTO dbo.divisions (division_name, display_order)
        OUTPUT INSERTED.*
        VALUES (@divisionName, @displayOrder)
      `);
    
    return result.recordset[0];
  }

  async updateDivision(data: UpdateDivisionRequest): Promise<Division | null> {
    const pool = await this.getPool();
    const updates: string[] = [];
    const request = pool.request().input('divisionId', sql.Int, data.division_id);

    if (data.division_name !== undefined) {
      updates.push('division_name = @divisionName');
      request.input('divisionName', sql.NVarChar(100), data.division_name);
    }
    if (data.display_order !== undefined) {
      updates.push('display_order = @displayOrder');
      request.input('displayOrder', sql.Int, data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = @isActive');
      request.input('isActive', sql.Bit, data.is_active);
    }

    if (updates.length === 0) return null;

    updates.push('modified_at = GETDATE()');

    const result = await request.query(`
      UPDATE dbo.divisions 
      SET ${updates.join(', ')}
      OUTPUT INSERTED.*
      WHERE division_id = @divisionId
    `);

    return result.recordset[0] || null;
  }

  // RECRUITERS

  async getRecruiters(includeInactive = false): Promise<RecruiterConfig[]> {
    const pool = await this.getPool();
    // Never include deleted recruiters, but optionally include inactive ones
    const query = includeInactive
      ? 'SELECT * FROM dbo.recruiter_config WHERE is_deleted = 0 ORDER BY division_id, display_order'
      : 'SELECT * FROM dbo.recruiter_config WHERE is_active = 1 AND is_deleted = 0 ORDER BY division_id, display_order';
    
    const result = await pool.request().query(query);
    return result.recordset;
  }

  async getRecruiterById(configId: number): Promise<RecruiterConfig | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('configId', sql.Int, configId)
      .query('SELECT * FROM dbo.recruiter_config WHERE config_id = @configId');
    
    return result.recordset[0] || null;
  }

  async getRecruitersByDivision(divisionId: number): Promise<RecruiterConfig[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('divisionId', sql.Int, divisionId)
      .query(`
        SELECT * FROM dbo.recruiter_config 
        WHERE division_id = @divisionId AND is_active = 1
        ORDER BY display_order
      `);
    
    return result.recordset;
  }

  async createRecruiter(data: CreateRecruiterRequest): Promise<RecruiterConfig> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.Int, data.user_id)
      .input('userName', sql.NVarChar(200), data.user_name)
      .input('divisionId', sql.Int, data.division_id)
      .input('weeklyGoal', sql.Decimal(10, 2), data.weekly_goal)
      .input('displayOrder', sql.Int, data.display_order || 0)
      .query(`
        INSERT INTO dbo.recruiter_config (user_id, user_name, division_id, weekly_goal, display_order)
        OUTPUT INSERTED.*
        VALUES (@userId, @userName, @divisionId, @weeklyGoal, @displayOrder)
      `);
    
    return result.recordset[0];
  }

  async updateRecruiter(data: UpdateRecruiterRequest): Promise<RecruiterConfig | null> {
    const pool = await this.getPool();
    const updates: string[] = [];
    const request = pool.request().input('configId', sql.Int, data.config_id);

    if (data.user_name !== undefined) {
      updates.push('user_name = @userName');
      request.input('userName', sql.NVarChar(200), data.user_name);
    }
    if (data.division_id !== undefined) {
      updates.push('division_id = @divisionId');
      request.input('divisionId', sql.Int, data.division_id);
    }
    if (data.weekly_goal !== undefined) {
      updates.push('weekly_goal = @weeklyGoal');
      request.input('weeklyGoal', sql.Decimal(10, 2), data.weekly_goal);
    }
    if (data.display_order !== undefined) {
      updates.push('display_order = @displayOrder');
      request.input('displayOrder', sql.Int, data.display_order);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = @isActive');
      request.input('isActive', sql.Bit, data.is_active);
    }

    if (updates.length === 0) return null;

    updates.push('modified_at = GETDATE()');

    const result = await request.query(`
      UPDATE dbo.recruiter_config 
      SET ${updates.join(', ')}
      OUTPUT INSERTED.*
      WHERE config_id = @configId
    `);

    return result.recordset[0] || null;
  }

  async deleteRecruiter(configId: number): Promise<boolean> {
    const pool = await this.getPool();
    // Soft delete - set is_deleted = 1 instead of actually removing
    const result = await pool.request()
      .input('configId', sql.Int, configId)
      .query(`
        UPDATE dbo.recruiter_config 
        SET is_deleted = 1, is_active = 0, modified_at = GETDATE()
        WHERE config_id = @configId
      `);
    
    return (result.rowsAffected[0] || 0) > 0;
  }

  // Check if a recruiter exists (including deleted ones) by user_id
  async recruiterExists(userId: number): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT 1 FROM dbo.recruiter_config WHERE user_id = @userId');
    
    return result.recordset.length > 0;
  }

  // REGIONS

  async getIncludedRegions(): Promise<IncludedRegion[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .query('SELECT * FROM dbo.included_regions WHERE is_active = 1 ORDER BY region_id');
    
    return result.recordset;
  }

  async getActiveRegionIds(): Promise<number[]> {
    const regions = await this.getIncludedRegions();
    return regions.map(r => r.region_id);
  }

  // SNAPSHOTS

  async upsertWeeklySnapshot(userId: number, weekStart: string, dayOfWeek: number, totalHours: number): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('weekStart', sql.Date, weekStart)
      .input('dayOfWeek', sql.TinyInt, dayOfWeek)
      .input('totalHours', sql.Decimal(10, 2), totalHours)
      .query(`
        MERGE dbo.weekly_snapshots AS target
        USING (SELECT @userId AS user_id, @weekStart AS week_start, @dayOfWeek AS day_of_week, @totalHours AS total_hours) AS source
        ON target.user_id = source.user_id AND target.week_start = source.week_start AND target.day_of_week = source.day_of_week
        WHEN MATCHED THEN
          UPDATE SET total_hours = source.total_hours, snapshot_taken_at = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (user_id, week_start, day_of_week, total_hours, snapshot_taken_at)
          VALUES (source.user_id, source.week_start, source.day_of_week, source.total_hours, GETDATE());
      `);
  }

  // Keep old method for backward compatibility during transition
  async upsertDailySnapshot(userId: number, shiftDate: string, totalHours: number): Promise<void> {
    // This is now deprecated - use upsertWeeklySnapshot instead
    console.warn('upsertDailySnapshot is deprecated, use upsertWeeklySnapshot');
  }

  async cleanupOldSnapshots(): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.request()
      .query(`
        DELETE FROM dbo.weekly_snapshots 
        WHERE week_start < DATEADD(day, -28, GETDATE())
      `);
    return result.rowsAffected[0] || 0;
  }

  // REPORT DATA

  async getReportData(weekPeriod?: string): Promise<ReportRow[]> {
    const pool = await this.getPool();
    let query = 'SELECT * FROM dbo.vw_report_pivoted';
    
    if (weekPeriod) {
      query += ' WHERE week_period = @weekPeriod';
    }
    
    query += ' ORDER BY division_order, recruiter_order, week_period';

    const request = pool.request();
    if (weekPeriod) {
      request.input('weekPeriod', sql.NVarChar(50), weekPeriod);
    }

    const result = await request.query(query);
    return result.recordset;
  }

  // Get report data with a week offset (for Monday recap which needs to shift back 1 week)
  async getReportDataWithOffset(weekOffset: number): Promise<ReportRow[]> {
    const pool = await this.getPool();
    
    // Calculate the reference date by offsetting from today
    const result = await pool.request()
      .input('weekOffset', sql.Int, weekOffset)
      .query(`
        WITH WeekDates AS (
          SELECT 
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS this_week_start,
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1 - 7, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS last_week_start,
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1 + 7, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS next_week_start
        ),
        SnapshotData AS (
          SELECT 
            ws.user_id,
            ws.week_start,
            ws.day_of_week,
            ws.total_hours,
            CASE 
              WHEN ws.week_start = wd.last_week_start THEN 'Last Week'
              WHEN ws.week_start = wd.this_week_start THEN 'This Week'
              WHEN ws.week_start = wd.next_week_start THEN 'Next Week'
              ELSE 'Other'
            END AS week_period
          FROM dbo.weekly_snapshots ws
          CROSS JOIN WeekDates wd
          WHERE ws.week_start IN (wd.last_week_start, wd.this_week_start, wd.next_week_start)
        )
        SELECT 
          rc.user_id,
          rc.user_name AS recruiter_name,
          rc.weekly_goal,
          rc.display_order AS recruiter_order,
          d.division_id,
          d.division_name,
          d.display_order AS division_order,
          wp.week_period,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 0 THEN sd.total_hours END), 0) AS sun_mon,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 1 THEN sd.total_hours END), 0) AS tue,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 2 THEN sd.total_hours END), 0) AS wed,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 3 THEN sd.total_hours END), 0) AS thu,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 4 THEN sd.total_hours END), 0) AS fri,
          ISNULL(MAX(CASE WHEN sd.day_of_week = 5 THEN sd.total_hours END), 0) AS sat,
          ISNULL(MAX(sd.total_hours), 0) AS weekly_total
        FROM dbo.recruiter_config rc
        INNER JOIN dbo.divisions d ON rc.division_id = d.division_id
        CROSS JOIN (SELECT 'Last Week' AS week_period UNION SELECT 'This Week' UNION SELECT 'Next Week') wp
        LEFT JOIN SnapshotData sd ON rc.user_id = sd.user_id AND sd.week_period = wp.week_period
        WHERE rc.is_active = 1 AND rc.is_deleted = 0 AND d.is_active = 1
        GROUP BY 
          rc.user_id, rc.user_name, rc.weekly_goal, rc.display_order,
          d.division_id, d.division_name, d.display_order, 
          wp.week_period
        ORDER BY d.display_order, rc.display_order, wp.week_period
      `);
    
    return result.recordset;
  }

  async getWeeklyTotals(): Promise<{ lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null }> {
    const pool = await this.getPool();
    
    // Get last week and this week from snapshots
    const result = await pool.request().query(`
      SELECT 
        week_period,
        SUM(sun_mon) AS sun_mon,
        SUM(tue) AS tue,
        SUM(wed) AS wed,
        SUM(thu) AS thu,
        SUM(fri) AS fri,
        SUM(sat) AS sat,
        SUM(weekly_total) AS total,
        SUM(weekly_goal) AS goal
      FROM dbo.vw_report_pivoted
      WHERE week_period IN ('Last Week', 'This Week')
      GROUP BY week_period
    `);

    const totals: { lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null } = {
      lastWeek: null,
      thisWeek: null,
      nextWeek: null
    };

    result.recordset.forEach((row: any) => {
      const weeklyTotal: WeeklyTotals = {
        week_period: row.week_period,
        sun_mon: row.sun_mon || 0,
        tue: row.tue || 0,
        wed: row.wed || 0,
        thu: row.thu || 0,
        fri: row.fri || 0,
        sat: row.sat || 0,
        total: row.total || 0,
        goal: row.goal || 0
      };
      
      if (row.week_period === 'Last Week') totals.lastWeek = weeklyTotal;
      if (row.week_period === 'This Week') totals.thisWeek = weeklyTotal;
    });

    // Get next week from live query
    // Calculate next week's date range
    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const thisWeekSunday = new Date(now);
    thisWeekSunday.setDate(now.getDate() - currentDayOfWeek);
    thisWeekSunday.setHours(0, 0, 0, 0);
    
    const nextWeekSunday = new Date(thisWeekSunday);
    nextWeekSunday.setDate(thisWeekSunday.getDate() + 7);
    const nextWeekSaturday = new Date(nextWeekSunday);
    nextWeekSaturday.setDate(nextWeekSunday.getDate() + 6);
    
    const nextWeekStart = nextWeekSunday.toISOString().split('T')[0];
    const nextWeekEnd = nextWeekSaturday.toISOString().split('T')[0];
    
    const liveNextWeek = await this.getLiveHoursByDay(nextWeekStart, nextWeekEnd);
    
    // Get total goal from active recruiters
    const goalResult = await pool.request().query(`
      SELECT SUM(weekly_goal) AS total_goal FROM dbo.recruiter_config WHERE is_active = 1 AND is_deleted = 0
    `);
    const totalGoal = goalResult.recordset[0]?.total_goal || 0;
    
    totals.nextWeek = {
      week_period: 'Next Week',
      sun_mon: liveNextWeek.sun_mon,
      tue: liveNextWeek.tue,
      wed: liveNextWeek.wed,
      thu: liveNextWeek.thu,
      fri: liveNextWeek.fri,
      sat: liveNextWeek.sat,
      total: liveNextWeek.sat, // Cumulative through Saturday is the total
      goal: totalGoal
    };

    return totals;
  }

  // Get weekly totals with a week offset (for Monday recap)
  async getWeeklyTotalsWithOffset(weekOffset: number): Promise<{ lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null }> {
    const pool = await this.getPool();
    
    // Get last week and this week from snapshots (with offset)
    const result = await pool.request()
      .input('weekOffset', sql.Int, weekOffset)
      .query(`
        WITH WeekDates AS (
          SELECT 
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS this_week_start,
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1 - 7, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS last_week_start,
            DATEADD(day, -DATEPART(weekday, DATEADD(week, @weekOffset, GETDATE())) + 1 + 7, CAST(DATEADD(week, @weekOffset, GETDATE()) AS DATE)) AS next_week_start
        ),
        SnapshotData AS (
          SELECT 
            ws.user_id,
            ws.week_start,
            ws.day_of_week,
            ws.total_hours,
            CASE 
              WHEN ws.week_start = wd.last_week_start THEN 'Last Week'
              WHEN ws.week_start = wd.this_week_start THEN 'This Week'
              WHEN ws.week_start = wd.next_week_start THEN 'Next Week'
              ELSE 'Other'
            END AS week_period
          FROM dbo.weekly_snapshots ws
          CROSS JOIN WeekDates wd
          WHERE ws.week_start IN (wd.last_week_start, wd.this_week_start)
        ),
        ReportData AS (
          SELECT 
            rc.user_id,
            rc.weekly_goal,
            wp.week_period,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 0 THEN sd.total_hours END), 0) AS sun_mon,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 1 THEN sd.total_hours END), 0) AS tue,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 2 THEN sd.total_hours END), 0) AS wed,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 3 THEN sd.total_hours END), 0) AS thu,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 4 THEN sd.total_hours END), 0) AS fri,
            ISNULL(MAX(CASE WHEN sd.day_of_week = 5 THEN sd.total_hours END), 0) AS sat,
            ISNULL(MAX(sd.total_hours), 0) AS weekly_total
          FROM dbo.recruiter_config rc
          CROSS JOIN (SELECT 'Last Week' AS week_period UNION SELECT 'This Week') wp
          LEFT JOIN SnapshotData sd ON rc.user_id = sd.user_id AND sd.week_period = wp.week_period
          WHERE rc.is_active = 1 AND rc.is_deleted = 0
          GROUP BY rc.user_id, rc.weekly_goal, wp.week_period
        )
        SELECT 
          week_period,
          SUM(sun_mon) AS sun_mon,
          SUM(tue) AS tue,
          SUM(wed) AS wed,
          SUM(thu) AS thu,
          SUM(fri) AS fri,
          SUM(sat) AS sat,
          SUM(weekly_total) AS total,
          SUM(weekly_goal) AS goal
        FROM ReportData
        GROUP BY week_period
      `);

    const totals: { lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null } = {
      lastWeek: null,
      thisWeek: null,
      nextWeek: null
    };

    result.recordset.forEach((row: any) => {
      const weeklyTotal: WeeklyTotals = {
        week_period: row.week_period,
        sun_mon: row.sun_mon || 0,
        tue: row.tue || 0,
        wed: row.wed || 0,
        thu: row.thu || 0,
        fri: row.fri || 0,
        sat: row.sat || 0,
        total: row.total || 0,
        goal: row.goal || 0
      };
      
      if (row.week_period === 'Last Week') totals.lastWeek = weeklyTotal;
      if (row.week_period === 'This Week') totals.thisWeek = weeklyTotal;
    });

    // Get next week from live query (with offset applied)
    const now = new Date();
    const offsetDate = new Date(now);
    offsetDate.setDate(now.getDate() + (weekOffset * 7));
    
    const currentDayOfWeek = offsetDate.getDay();
    const thisWeekSunday = new Date(offsetDate);
    thisWeekSunday.setDate(offsetDate.getDate() - currentDayOfWeek);
    thisWeekSunday.setHours(0, 0, 0, 0);
    
    const nextWeekSunday = new Date(thisWeekSunday);
    nextWeekSunday.setDate(thisWeekSunday.getDate() + 7);
    const nextWeekSaturday = new Date(nextWeekSunday);
    nextWeekSaturday.setDate(nextWeekSunday.getDate() + 6);
    
    const nextWeekStart = nextWeekSunday.toISOString().split('T')[0];
    const nextWeekEnd = nextWeekSaturday.toISOString().split('T')[0];
    
    const liveNextWeek = await this.getLiveHoursByDay(nextWeekStart, nextWeekEnd);
    
    // Get total goal from active recruiters
    const goalResult = await pool.request().query(`
      SELECT SUM(weekly_goal) AS total_goal FROM dbo.recruiter_config WHERE is_active = 1 AND is_deleted = 0
    `);
    const totalGoal = goalResult.recordset[0]?.total_goal || 0;
    
    totals.nextWeek = {
      week_period: 'Next Week',
      sun_mon: liveNextWeek.sun_mon,
      tue: liveNextWeek.tue,
      wed: liveNextWeek.wed,
      thu: liveNextWeek.thu,
      fri: liveNextWeek.fri,
      sat: liveNextWeek.sat,
      total: liveNextWeek.sat,
      goal: totalGoal
    };

    return totals;
  }

  // Get hours directly from ghr_ctmsync orders table
  // This bypasses the ClearConnect API and queries the source data directly
  // Returns { hoursMap, orderCount, regionNames }
  async getHoursFromOrders(weekStart: string, weekEnd: string): Promise<{ hoursMap: Map<number, number>, orderCount: number, regionNames: string[] }> {
    const pool = await this.getCtmsyncPool();
    
    // Get hours and order counts by staffer
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT 
          u.userid,
          COUNT(*) AS order_count,
          SUM(DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) / 60.0) AS total_hours
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
        GROUP BY u.userid
      `);
    
    const hoursMap = new Map<number, number>();
    let totalOrders = 0;
    for (const row of result.recordset) {
      hoursMap.set(row.userid, row.total_hours || 0);
      totalOrders += row.order_count || 0;
    }
    
    // Get distinct region names from filled orders
    const regionsResult = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT DISTINCT r.regionname
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.regions r ON pt.homeregion = r.regionid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
          AND r.regionname IS NOT NULL
        ORDER BY r.regionname
      `);
    
    const regionNames = regionsResult.recordset.map((row: any) => row.regionname);
    
    return { hoursMap, orderCount: totalOrders, regionNames };
  }

  // Get user name from ctmsync users table
  async getUserNameFromCtmsync(userId: number): Promise<string | null> {
    const pool = await this.getCtmsyncPool();
    
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT firstname, lastname 
        FROM dbo.users 
        WHERE userid = @userId
      `);
    
    if (result.recordset.length > 0) {
      const row = result.recordset[0];
      return `${row.firstname} ${row.lastname}`.trim();
    }
    
    return null;
  }

  // Get live cumulative hours by day for a week (for forecasting next week and current week's remaining days)
  // Returns cumulative totals through each day: sun_mon, tue (sun-tue), wed (sun-wed), etc.
  // Only counts hours for active, non-deleted recruiters
  async getLiveHoursByDay(weekStart: string, weekEnd: string): Promise<{ sun_mon: number, tue: number, wed: number, thu: number, fri: number, sat: number }> {
    const ctmsyncPool = await this.getCtmsyncPool();
    const hoursReportPool = await this.getPool();
    
    // Get active recruiter user IDs
    const recruitersResult = await hoursReportPool.request().query(`
      SELECT user_id FROM dbo.recruiter_config WHERE is_active = 1 AND is_deleted = 0
    `);
    const activeUserIds = new Set(recruitersResult.recordset.map((r: any) => r.user_id));
    
    if (activeUserIds.size === 0) {
      return { sun_mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    }
    
    // Query orders grouped by day of week
    const result = await ctmsyncPool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT 
          u.userid,
          DATEPART(weekday, o.shiftstarttime) AS day_of_week,
          SUM(DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) / 60.0) AS total_hours
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
        GROUP BY u.userid, DATEPART(weekday, o.shiftstarttime)
      `);
    
    // Accumulate hours by day (DATEPART weekday: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat)
    const dayTotals = { sun: 0, mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0 };
    
    for (const row of result.recordset) {
      // Only count hours for active recruiters
      if (!activeUserIds.has(row.userid)) continue;
      
      const hours = row.total_hours || 0;
      switch (row.day_of_week) {
        case 1: dayTotals.sun += hours; break;
        case 2: dayTotals.mon += hours; break;
        case 3: dayTotals.tue += hours; break;
        case 4: dayTotals.wed += hours; break;
        case 5: dayTotals.thu += hours; break;
        case 6: dayTotals.fri += hours; break;
        case 7: dayTotals.sat += hours; break;
      }
    }
    
    // Return cumulative totals through each day
    const sun_mon = dayTotals.sun + dayTotals.mon;
    const tue = sun_mon + dayTotals.tue;
    const wed = tue + dayTotals.wed;
    const thu = wed + dayTotals.thu;
    const fri = thu + dayTotals.fri;
    const sat = fri + dayTotals.sat;
    
    return {
      sun_mon: Math.round(sun_mon * 100) / 100,
      tue: Math.round(tue * 100) / 100,
      wed: Math.round(wed * 100) / 100,
      thu: Math.round(thu * 100) / 100,
      fri: Math.round(fri * 100) / 100,
      sat: Math.round(sat * 100) / 100
    };
  }
}

export const databaseService = new DatabaseService();
