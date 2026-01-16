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

  async getWeeklyTotals(): Promise<{ lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null }> {
    const pool = await this.getPool();
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
      if (row.week_period === 'Next Week') totals.nextWeek = weeklyTotal;
    });

    return totals;
  }

  // Get hours directly from ghr_ctmsync orders table
  // This bypasses the ClearConnect API and queries the source data directly
  async getHoursFromOrders(weekStart: string, weekEnd: string): Promise<Map<number, number>> {
    const pool = await this.getCtmsyncPool();
    
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT 
          u.userid,
          SUM(DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) / 60.0) AS total_hours
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
        GROUP BY u.userid
      `);
    
    const hoursMap = new Map<number, number>();
    for (const row of result.recordset) {
      hoursMap.set(row.userid, row.total_hours || 0);
    }
    
    return hoursMap;
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
}

export const databaseService = new DatabaseService();
