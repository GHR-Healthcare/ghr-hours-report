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
  UpdateDivisionRequest,
  DivisionAtsMapping,
  PlacementData,
  StackRankingRow,
  StackRankingSnapshot,
  AtsSystem,
  UserConfig,
  CreateUserConfigRequest,
  UpdateUserConfigRequest,
  AppConfig,
} from '../types';

class DatabaseService {
  private pool: sql.ConnectionPool | null = null;
  private ctmsyncPool: sql.ConnectionPool | null = null;
  private bullhornPool: sql.ConnectionPool | null = null;
  private config: sql.config;
  private ctmsyncConfig: sql.config;
  private bullhornConnectionString: string;

  constructor() {
    // Main hours_report database
    this.config = {
      server: process.env.SQL_SERVER || '',
      database: process.env.SQL_DATABASE || 'hours_report',
      user: process.env.SQL_USER || '',
      password: process.env.SQL_PASSWORD || '',
      requestTimeout: 600000, // 10 minutes for large queries
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
      requestTimeout: 600000, // 10 minutes for large queries
      options: {
        encrypt: true,
        trustServerCertificate: false
      }
    };

    // Bullhorn mirror database (separate server, single connection string)
    this.bullhornConnectionString = process.env.BULLHORN_CONNECTION_STRING || '';
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

  async getBullhornPool(): Promise<sql.ConnectionPool> {
    if (!this.bullhornPool) {
      this.bullhornPool = await new sql.ConnectionPool(this.bullhornConnectionString).connect();
    }
    return this.bullhornPool;
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
    if (this.bullhornPool) {
      await this.bullhornPool.close();
      this.bullhornPool = null;
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

  // RECRUITERS — now redirect to user_config table

  async getRecruiters(includeInactive = false): Promise<RecruiterConfig[]> {
    const pool = await this.getPool();
    const query = includeInactive
      ? 'SELECT * FROM dbo.user_config WHERE on_hours_report = 1 ORDER BY division_id, display_order'
      : 'SELECT * FROM dbo.user_config WHERE is_active = 1 AND on_hours_report = 1 ORDER BY division_id, display_order';
    const result = await pool.request().query(query);
    return result.recordset;
  }

  async getRecruiterById(configId: number): Promise<RecruiterConfig | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('configId', sql.Int, configId)
      .query('SELECT * FROM dbo.user_config WHERE config_id = @configId');
    return result.recordset[0] || null;
  }

  async getRecruitersByDivision(divisionId: number): Promise<RecruiterConfig[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('divisionId', sql.Int, divisionId)
      .query(`
        SELECT * FROM dbo.user_config
        WHERE division_id = @divisionId AND is_active = 1 AND on_hours_report = 1
        ORDER BY display_order
      `);
    return result.recordset;
  }

  async createRecruiter(data: CreateRecruiterRequest): Promise<RecruiterConfig> {
    // Redirect to user_config with on_hours_report = true
    // Hours report data comes from Symplr/ClearConnect, so set symplr_user_id
    const userConfig = await this.createUserConfig({
      user_id: data.user_id,
      user_name: data.user_name,
      division_id: data.division_id,
      weekly_goal: data.weekly_goal,
      symplr_user_id: data.user_id,
      on_hours_report: true,
      on_stack_ranking: false,
      display_order: data.display_order,
    });
    return userConfig as any;
  }

  async updateRecruiter(data: UpdateRecruiterRequest): Promise<RecruiterConfig | null> {
    const result = await this.updateUserConfig({
      config_id: data.config_id,
      user_name: data.user_name,
      division_id: data.division_id,
      weekly_goal: data.weekly_goal,
      display_order: data.display_order,
      is_active: data.is_active,
    });
    return result as any;
  }

  async deleteRecruiter(configId: number): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('configId', sql.Int, configId)
      .query(`
        UPDATE dbo.user_config
        SET is_active = 0, modified_at = GETDATE()
        WHERE config_id = @configId
      `);
    return (result.rowsAffected[0] || 0) > 0;
  }

  async recruiterExists(userId: number): Promise<boolean> {
    return this.userConfigExists(userId);
  }

  // USER CONFIG (unified table for both reports)

  async getUserConfigs(includeInactive = false): Promise<UserConfig[]> {
    const pool = await this.getPool();
    const query = includeInactive
      ? 'SELECT * FROM dbo.user_config ORDER BY division_id, display_order'
      : 'SELECT * FROM dbo.user_config WHERE is_active = 1 ORDER BY division_id, display_order';
    const result = await pool.request().query(query);
    return result.recordset;
  }

  async createUserConfig(data: CreateUserConfigRequest): Promise<UserConfig> {
    const pool = await this.getPool();
    const symplrId = data.symplr_user_id ?? null;
    const bullhornId = data.bullhorn_user_id ?? null;
    const canonicalUserId = data.user_id || symplrId || bullhornId || 0;
    const result = await pool.request()
      .input('userId', sql.Int, canonicalUserId)
      .input('userName', sql.NVarChar(200), data.user_name)
      .input('divisionId', sql.Int, data.division_id)
      .input('role', sql.VarChar(50), data.role || 'unknown')
      .input('title', sql.NVarChar(200), data.title || null)
      .input('atsSource', sql.VarChar(20), data.ats_source || null)
      .input('symplrUserId', sql.Int, symplrId)
      .input('bullhornUserId', sql.Int, bullhornId)
      .input('weeklyGoal', sql.Int, data.weekly_goal || 0)
      .input('onHoursReport', sql.Bit, data.on_hours_report ?? false)
      .input('onStackRanking', sql.Bit, data.on_stack_ranking ?? false)
      .input('displayOrder', sql.Int, data.display_order || 99)
      .query(`
        INSERT INTO dbo.user_config (user_id, user_name, division_id, role, title, ats_source, symplr_user_id, bullhorn_user_id, weekly_goal, on_hours_report, on_stack_ranking, display_order)
        OUTPUT INSERTED.*
        VALUES (@userId, @userName, @divisionId, @role, @title, @atsSource, @symplrUserId, @bullhornUserId, @weeklyGoal, @onHoursReport, @onStackRanking, @displayOrder)
      `);
    return result.recordset[0];
  }

  async updateUserConfig(data: UpdateUserConfigRequest): Promise<UserConfig | null> {
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
    if (data.role !== undefined) {
      updates.push('role = @role');
      request.input('role', sql.VarChar(50), data.role);
    }
    if (data.title !== undefined) {
      updates.push('title = @title');
      request.input('title', sql.NVarChar(200), data.title);
    }
    if (data.weekly_goal !== undefined) {
      updates.push('weekly_goal = @weeklyGoal');
      request.input('weeklyGoal', sql.Int, data.weekly_goal);
    }
    if (data.on_hours_report !== undefined) {
      updates.push('on_hours_report = @onHoursReport');
      request.input('onHoursReport', sql.Bit, data.on_hours_report);
    }
    if (data.on_stack_ranking !== undefined) {
      updates.push('on_stack_ranking = @onStackRanking');
      request.input('onStackRanking', sql.Bit, data.on_stack_ranking);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = @isActive');
      request.input('isActive', sql.Bit, data.is_active);
    }
    if (data.display_order !== undefined) {
      updates.push('display_order = @displayOrder');
      request.input('displayOrder', sql.Int, data.display_order);
    }
    if (data.symplr_user_id !== undefined) {
      updates.push('symplr_user_id = @symplrUserId');
      request.input('symplrUserId', sql.Int, data.symplr_user_id);
    }
    if (data.bullhorn_user_id !== undefined) {
      updates.push('bullhorn_user_id = @bullhornUserId');
      request.input('bullhornUserId', sql.Int, data.bullhorn_user_id);
    }

    if (updates.length === 0) return null;
    updates.push('modified_at = GETDATE()');

    const atsIdChanged = data.symplr_user_id !== undefined || data.bullhorn_user_id !== undefined;

    const result = await request.query(`
      UPDATE dbo.user_config
      SET ${updates.join(', ')}
      OUTPUT INSERTED.*
      WHERE config_id = @configId
    `);

    // Recalculate canonical user_id when ATS IDs change
    if (atsIdChanged && result.recordset[0]) {
      await pool.request()
        .input('configId', sql.Int, data.config_id)
        .query(`
          UPDATE dbo.user_config
          SET user_id = COALESCE(symplr_user_id, bullhorn_user_id, user_id)
          WHERE config_id = @configId
        `);
      // Re-fetch the updated row
      const refreshed = await pool.request()
        .input('configId', sql.Int, data.config_id)
        .query('SELECT * FROM dbo.user_config WHERE config_id = @configId');
      return refreshed.recordset[0] || null;
    }

    return result.recordset[0] || null;
  }

  async userConfigExists(userId: number): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT 1 FROM dbo.user_config WHERE user_id = @userId');
    return result.recordset.length > 0;
  }

  async userConfigExistsByAtsId(atsSystem: AtsSystem, atsUserId: number): Promise<boolean> {
    const pool = await this.getPool();
    const column = atsSystem === 'symplr' ? 'symplr_user_id' : 'bullhorn_user_id';
    const result = await pool.request()
      .input('atsUserId', sql.Int, atsUserId)
      .query(`SELECT 1 FROM dbo.user_config WHERE ${column} = @atsUserId`);
    return result.recordset.length > 0;
  }

  async getUserConfigByAtsId(atsSystem: AtsSystem, atsUserId: number): Promise<UserConfig | null> {
    const pool = await this.getPool();
    const column = atsSystem === 'symplr' ? 'symplr_user_id' : 'bullhorn_user_id';
    const result = await pool.request()
      .input('atsUserId', sql.Int, atsUserId)
      .query(`SELECT * FROM dbo.user_config WHERE ${column} = @atsUserId`);
    return result.recordset[0] || null;
  }

  async getAtsIdToConfigMap(atsSystem: AtsSystem): Promise<Map<number, UserConfig>> {
    const pool = await this.getPool();
    const column = atsSystem === 'symplr' ? 'symplr_user_id' : 'bullhorn_user_id';
    const result = await pool.request()
      .query(`SELECT * FROM dbo.user_config WHERE ${column} IS NOT NULL AND is_active = 1`);
    const map = new Map<number, UserConfig>();
    for (const row of result.recordset) {
      const atsId = atsSystem === 'symplr' ? row.symplr_user_id : row.bullhorn_user_id;
      if (atsId != null) map.set(atsId, row);
    }
    return map;
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

  // Batch upsert for better performance - processes snapshots in parallel batches
  async upsertWeeklySnapshotsBatch(snapshots: Array<{userId: number, weekStart: string, dayOfWeek: number, totalHours: number}>): Promise<void> {
    if (snapshots.length === 0) return;
    
    // Process in parallel batches of 10 concurrent requests
    const batchSize = 10;
    for (let i = 0; i < snapshots.length; i += batchSize) {
      const batch = snapshots.slice(i, i + batchSize);
      await Promise.all(batch.map(s => 
        this.upsertWeeklySnapshot(s.userId, s.weekStart, s.dayOfWeek, s.totalHours)
      ));
    }
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

  // Clear all snapshots for a specific week - used when week rolls over
  // to remove stale "Next Week" snapshots that are now "This Week"
  async clearWeekSnapshots(weekStart: string): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .query(`
        DELETE FROM dbo.weekly_snapshots 
        WHERE week_start = @weekStart
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
        FROM dbo.user_config rc
        INNER JOIN dbo.divisions d ON rc.division_id = d.division_id
        CROSS JOIN (SELECT 'Last Week' AS week_period UNION SELECT 'This Week' UNION SELECT 'Next Week') wp
        LEFT JOIN SnapshotData sd ON rc.user_id = sd.user_id AND sd.week_period = wp.week_period
        WHERE rc.is_active = 1 AND rc.on_hours_report = 1 AND d.is_active = 1
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
    
    // Get all three weeks from snapshots
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

  // Get weekly totals with a week offset (for Monday recap)
  async getWeeklyTotalsWithOffset(weekOffset: number): Promise<{ lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null }> {
    const pool = await this.getPool();
    
    // Get all three weeks from snapshots (with offset)
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
          FROM dbo.user_config rc
          CROSS JOIN (SELECT 'Last Week' AS week_period UNION SELECT 'This Week' UNION SELECT 'Next Week') wp
          LEFT JOIN SnapshotData sd ON rc.user_id = sd.user_id AND sd.week_period = wp.week_period
          WHERE rc.is_active = 1 AND rc.on_hours_report = 1
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
      if (row.week_period === 'Next Week') totals.nextWeek = weeklyTotal;
    });

    return totals;
  }

  // Get hours directly from ghr_ctmsync orders table
  // This bypasses the ClearConnect API and queries the source data directly
  // Returns { hoursMap, lunchMinutesMap, orderCount, regionNames }
  async getHoursFromOrders(weekStart: string, weekEnd: string): Promise<{ hoursMap: Map<number, number>, lunchMinutesMap: Map<number, number>, orderCount: number, regionNames: string[] }> {
    const pool = await this.getCtmsyncPool();

    // Get hours and order counts by staffer, with lunch minutes subtracted
    // Use DefaultLunchMins from client profile instead of lesslunchmin from order
    // because lesslunchmin is only populated after payment
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT
          u.userid,
          COUNT(*) AS order_count,
          SUM(DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) - ISNULL(pc.defaultlunchmins, 0)) / 60.0 AS total_hours,
          SUM(ISNULL(pc.defaultlunchmins, 0)) / 60.0 AS lunch_hours
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
        LEFT JOIN dbo.profile_client pc ON o.customerid = pc.recordid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
        GROUP BY u.userid
      `);

    const hoursMap = new Map<number, number>();
    const lunchMinutesMap = new Map<number, number>();
    let totalOrders = 0;
    for (const row of result.recordset) {
      hoursMap.set(row.userid, row.total_hours || 0);
      lunchMinutesMap.set(row.userid, (row.lunch_hours || 0) * 60); // Convert back to minutes for display
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

    return { hoursMap, lunchMinutesMap, orderCount: totalOrders, regionNames };
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

  // Get user title from ctmsync users table
  async getUserTitleFromCtmsync(userId: number): Promise<string | null> {
    const pool = await this.getCtmsyncPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT title FROM dbo.users WHERE userid = @userId`);
    return result.recordset[0]?.title || null;
  }

  // Get user title from Bullhorn CorporateUser table
  async getUserTitleFromBullhorn(userId: number): Promise<string | null> {
    if (!this.bullhornConnectionString) return null;
    const pool = await this.getBullhornPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`SELECT occupation FROM dbo.CorporateUser WHERE userID = @userId`);
    return result.recordset[0]?.occupation || null;
  }

  // Get user department name from Bullhorn
  async getUserDepartmentFromBullhorn(userId: number): Promise<string | null> {
    if (!this.bullhornConnectionString) return null;
    const pool = await this.getBullhornPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .query(`
        SELECT TOP 1 cd.name AS department_name
        FROM dbo.CorporateUserDepartments cud
        INNER JOIN dbo.CorporationDepartment cd ON cud.departmentID = cd.corporationDepartmentID
        WHERE cud.userID = @userId AND cud.isDeleted = 0 AND cd.isDeleted = 0
      `);
    return result.recordset[0]?.department_name || null;
  }

  // Find a division by name (case-insensitive)
  async findDivisionByName(name: string): Promise<number | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('name', sql.NVarChar(200), name)
      .query(`SELECT division_id FROM dbo.divisions WHERE LOWER(division_name) = LOWER(@name) AND is_active = 1`);
    return result.recordset[0]?.division_id || null;
  }

  // Get live hours by day for a week (for forecasting next week)
  // Returns per-day totals (NOT cumulative) - each column shows just that day's hours
  // Only counts hours for active, non-deleted recruiters
  async getLiveHoursByDay(weekStart: string, weekEnd: string): Promise<{ sun_mon: number, tue: number, wed: number, thu: number, fri: number, sat: number }> {
    const ctmsyncPool = await this.getCtmsyncPool();
    const hoursReportPool = await this.getPool();
    
    // Get active recruiter user IDs
    const recruitersResult = await hoursReportPool.request().query(`
      SELECT user_id FROM dbo.user_config WHERE is_active = 1 AND on_hours_report = 1
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
    
    // Return per-day totals (NOT cumulative) - matching original PHP behavior
    // Sun/Mon combined in one column, others are individual days
    const sun_mon = dayTotals.sun + dayTotals.mon;
    
    return {
      sun_mon: Math.round(sun_mon * 100) / 100,
      tue: Math.round(dayTotals.tue * 100) / 100,
      wed: Math.round(dayTotals.wed * 100) / 100,
      thu: Math.round(dayTotals.thu * 100) / 100,
      fri: Math.round(dayTotals.fri * 100) / 100,
      sat: Math.round(dayTotals.sat * 100) / 100
    };
  }

  // ==========================================
  // STACK RANKING
  // ==========================================

  async getDivisionAtsMappings(): Promise<DivisionAtsMapping[]> {
    const pool = await this.getPool();
    const result = await pool.request().query(
      'SELECT division_id, ats_system FROM dbo.division_ats_mapping'
    );
    return result.recordset;
  }

  async getSymplrPlacementData(weekStart: string, weekEnd: string): Promise<PlacementData[]> {
    const pool = await this.getCtmsyncPool();

    // Get recruiter-to-division mapping from hours_report DB using symplr_user_id
    const symplrMap = await this.getAtsIdToConfigMap('symplr');
    const divisions = await this.getDivisions(false);
    const divisionMap = new Map(divisions.map(d => [d.division_id, d.division_name]));
    const recruiterDivisionMap = new Map<number, { division_id: number; division_name: string }>();
    for (const [atsId, config] of symplrMap) {
      recruiterDivisionMap.set(atsId, {
        division_id: config.division_id,
        division_name: divisionMap.get(config.division_id) || 'Unknown'
      });
    }

    // Use pre-computed totalbillamount and totalpayamount from orders
    // These already include all rate tiers (regular, OT, holiday, double time, extras)
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        SELECT
          u.userid AS recruiter_user_id,
          u.firstname + ' ' + u.lastname AS recruiter_name,
          COUNT(DISTINCT o.filledby) AS head_count,
          SUM(ISNULL(o.totalbillamount, 0)) AS total_bill_amount,
          SUM(ISNULL(o.totalpayamount, 0)) AS total_pay_amount
        FROM dbo.orders o
        INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
        INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
        WHERE o.status = 'filled'
          AND CAST(o.shiftstarttime AS DATE) BETWEEN @weekStart AND @weekEnd
        GROUP BY u.userid, u.firstname, u.lastname
      `);

    return result.recordset.map((row: any) => {
      const divInfo = recruiterDivisionMap.get(row.recruiter_user_id);
      return {
        recruiter_user_id: row.recruiter_user_id,
        recruiter_name: row.recruiter_name,
        division_id: divInfo?.division_id || 0,
        division_name: divInfo?.division_name || 'Unknown',
        head_count: row.head_count || 0,
        total_bill_amount: row.total_bill_amount || 0,
        total_pay_amount: row.total_pay_amount || 0,
      };
    });
  }

  async getBullhornPlacementData(weekStart: string, weekEnd: string): Promise<PlacementData[]> {
    if (!this.bullhornConnectionString) {
      console.warn('Bullhorn connection not configured, skipping');
      return [];
    }

    const pool = await this.getBullhornPool();

    // Get recruiter-to-division mapping from hours_report DB using bullhorn_user_id
    const bullhornMap = await this.getAtsIdToConfigMap('bullhorn');
    const divisions = await this.getDivisions(false);
    const divisionMap = new Map(divisions.map(d => [d.division_id, d.division_name]));
    const recruiterDivisionMap = new Map<number, { division_id: number; division_name: string }>();
    for (const [atsId, config] of bullhornMap) {
      recruiterDivisionMap.set(atsId, {
        division_id: config.division_id,
        division_name: divisionMap.get(config.division_id) || 'Unknown'
      });
    }

    // Query placements active during the week
    // Calculate weekday overlap and multiply by hoursPerDay * rates
    const result = await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .input('weekEnd', sql.Date, weekEnd)
      .query(`
        WITH ActivePlacements AS (
          SELECT
            p.ownerID,
            p.candidateID,
            p.clientBillRate,
            p.payRate,
            p.hoursPerDay,
            -- Calculate overlap start/end with the query week
            CASE WHEN p.dateBegin > @weekStart THEN CAST(p.dateBegin AS DATE) ELSE @weekStart END AS overlap_start,
            CASE WHEN ISNULL(p.dateEnd, @weekEnd) < @weekEnd THEN CAST(p.dateEnd AS DATE) ELSE @weekEnd END AS overlap_end
          FROM dbo.Placement p
          WHERE p.dateBegin <= @weekEnd
            AND ISNULL(p.dateEnd, @weekEnd) >= @weekStart
            AND p.status IN ('Started', 'Approved', 'Completed', 'Cleared')
        ),
        PlacementDays AS (
          SELECT
            ownerID,
            candidateID,
            clientBillRate,
            payRate,
            hoursPerDay,
            -- Count weekdays in the overlap period
            DATEDIFF(dd, overlap_start, overlap_end) + 1
            - (DATEDIFF(wk, overlap_start, overlap_end) * 2)
            - CASE WHEN DATEPART(dw, overlap_start) = 1 THEN 1 ELSE 0 END
            - CASE WHEN DATEPART(dw, overlap_end) = 7 THEN 1 ELSE 0 END
            AS weekdays
          FROM ActivePlacements
          WHERE overlap_start <= overlap_end
        )
        SELECT
          pd.ownerID AS recruiter_user_id,
          cu.firstName + ' ' + cu.lastName AS recruiter_name,
          COUNT(DISTINCT pd.candidateID) AS head_count,
          SUM(ISNULL(pd.clientBillRate, 0) * ISNULL(pd.hoursPerDay, 8) * pd.weekdays) AS total_bill_amount,
          SUM(ISNULL(pd.payRate, 0) * ISNULL(pd.hoursPerDay, 8) * pd.weekdays) AS total_pay_amount
        FROM PlacementDays pd
        INNER JOIN dbo.CorporateUser cu ON pd.ownerID = cu.userID
        WHERE pd.weekdays > 0
        GROUP BY pd.ownerID, cu.firstName, cu.lastName
      `);

    return result.recordset.map((row: any) => {
      const divInfo = recruiterDivisionMap.get(row.recruiter_user_id);
      return {
        recruiter_user_id: row.recruiter_user_id,
        recruiter_name: row.recruiter_name,
        division_id: divInfo?.division_id || 0,
        division_name: divInfo?.division_name || 'Unknown',
        head_count: row.head_count || 0,
        total_bill_amount: row.total_bill_amount || 0,
        total_pay_amount: row.total_pay_amount || 0,
      };
    });
  }

  async saveStackRankingSnapshot(weekStart: string, rows: StackRankingRow[]): Promise<void> {
    const pool = await this.getPool();

    // Delete existing snapshot for this week (idempotent re-runs)
    await pool.request()
      .input('weekStart', sql.Date, weekStart)
      .query('DELETE FROM dbo.stack_ranking_snapshots WHERE week_start = @weekStart');

    // Insert new snapshot rows in batches
    const batchSize = 10;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await Promise.all(batch.map(row =>
        pool.request()
          .input('weekStart', sql.Date, weekStart)
          .input('userId', sql.Int, row.recruiter_user_id)
          .input('name', sql.NVarChar(200), row.recruiter_name)
          .input('division', sql.NVarChar(100), row.division_name)
          .input('rank', sql.Int, row.rank)
          .input('hc', sql.Int, row.head_count)
          .input('gm', sql.Decimal(12, 2), row.gross_margin_dollars)
          .input('gp', sql.Decimal(6, 2), row.gross_profit_pct)
          .input('revenue', sql.Decimal(12, 2), row.revenue)
          .query(`
            INSERT INTO dbo.stack_ranking_snapshots
              (week_start, recruiter_user_id, recruiter_name, division_name,
               rank, head_count, gross_margin_dollars, gross_profit_pct, revenue)
            VALUES
              (@weekStart, @userId, @name, @division,
               @rank, @hc, @gm, @gp, @revenue)
          `)
      ));
    }
  }

  async getPriorWeekSnapshot(priorWeekStart: string): Promise<StackRankingSnapshot[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('weekStart', sql.Date, priorWeekStart)
      .query(`
        SELECT * FROM dbo.stack_ranking_snapshots
        WHERE week_start = @weekStart
        ORDER BY rank
      `);
    return result.recordset;
  }

  async cleanupOldStackRankingSnapshots(): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.request().query(`
      DELETE FROM dbo.stack_ranking_snapshots
      WHERE week_start < DATEADD(week, -12, GETDATE())
    `);
    return result.rowsAffected[0] || 0;
  }
  // ==========================================
  // APP CONFIG
  // ==========================================

  async getConfigValue(key: string): Promise<string | null> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('key', sql.VarChar(100), key)
      .query('SELECT config_value FROM dbo.app_config WHERE config_key = @key');
    return result.recordset[0]?.config_value ?? null;
  }

  async getAllConfigs(): Promise<AppConfig[]> {
    const pool = await this.getPool();
    const result = await pool.request()
      .query('SELECT config_key, config_value, description, created_at, modified_at FROM dbo.app_config ORDER BY config_key');
    return result.recordset;
  }

  async upsertConfig(key: string, value: string, description?: string): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('key', sql.VarChar(100), key)
      .input('value', sql.NVarChar(sql.MAX), value)
      .input('description', sql.NVarChar(500), description || null)
      .query(`
        MERGE dbo.app_config AS target
        USING (SELECT @key AS config_key) AS source
        ON target.config_key = source.config_key
        WHEN MATCHED THEN
            UPDATE SET config_value = @value,
                       description = ISNULL(@description, target.description),
                       modified_at = GETDATE()
        WHEN NOT MATCHED THEN
            INSERT (config_key, config_value, description)
            VALUES (@key, @value, @description);
      `);
  }

  async deleteConfig(key: string): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.request()
      .input('key', sql.VarChar(100), key)
      .query('DELETE FROM dbo.app_config WHERE config_key = @key');
    return (result.rowsAffected[0] || 0) > 0;
  }
}

export const databaseService = new DatabaseService();
