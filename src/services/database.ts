import * as sql from 'mssql';
import { 
  Division, 
  RecruiterConfig, 
  IncludedRegion, 
  ReportRow,
  CreateRecruiterRequest,
  UpdateRecruiterRequest,
  CreateDivisionRequest,
  UpdateDivisionRequest
} from '../types';

class DatabaseService {
  private pool: sql.ConnectionPool | null = null;
  private config: sql.config;

  constructor() {
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
  }

  /**
   * Get database connection pool
   */
  async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await sql.connect(this.config);
    }
    return this.pool;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
  }

  // ============================================
  // DIVISIONS
  // ============================================

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

  // ============================================
  // RECRUITERS
  // ============================================

  async getRecruiters(includeInactive = false): Promise<RecruiterConfig[]> {
    const pool = await this.getPool();
    const query = includeInactive
      ? 'SELECT * FROM dbo.recruiter_config ORDER BY division_id, display_order'
      : 'SELECT * FROM dbo.recruiter_config WHERE is_active = 1 ORDER BY division_id, display_order';
    
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
    const result = await pool.request()
      .input('configId', sql.Int, configId)
      .query('DELETE FROM dbo.recruiter_config WHERE config_id = @configId');
    
    return (result.rowsAffected[0] || 0) > 0;
  }

  // ============================================
  // REGIONS
  // ============================================

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

  // ============================================
  // SNAPSHOTS
  // ============================================

  async upsertDailySnapshot(userId: number, shiftDate: string, totalHours: number): Promise<void> {
    const pool = await this.getPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('shiftDate', sql.Date, shiftDate)
      .input('totalHours', sql.Decimal(10, 2), totalHours)
      .execute('dbo.upsert_daily_snapshot');
  }

  async cleanupOldSnapshots(): Promise<number> {
    const pool = await this.getPool();
    const result = await pool.request().execute('dbo.cleanup_old_snapshots');
    return result.recordset[0]?.rows_deleted || 0;
  }

  // ============================================
  // REPORT DATA
  // ============================================

  async getReportData(weekPeriod?: 'Last Week' | 'This Week' | 'Next Week'): Promise<ReportRow[]> {
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

  async getWeeklyTotals(): Promise<{ lastWeek: any; thisWeek: any; nextWeek: any }> {
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

    const totals: any = {
      lastWeek: null,
      thisWeek: null,
      nextWeek: null
    };

    result.recordset.forEach((row: any) => {
      if (row.week_period === 'Last Week') totals.lastWeek = row;
      if (row.week_period === 'This Week') totals.thisWeek = row;
      if (row.week_period === 'Next Week') totals.nextWeek = row;
    });

    return totals;
  }

  /**
   * Get active recruiter user IDs
   */
  async getActiveRecruiterIds(): Promise<number[]> {
    const recruiters = await this.getRecruiters(false);
    return recruiters.map(r => r.user_id);
  }
}

export const databaseService = new DatabaseService();
