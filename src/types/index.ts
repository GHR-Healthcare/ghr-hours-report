// Database Types

export interface Division {
  division_id: number;
  division_name: string;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  modified_at: Date;
}

export type RecruiterRole = 'recruiter' | 'account_manager' | 'unknown';

export interface RecruiterConfig {
  config_id: number;
  user_id: number;
  user_name: string;
  division_id: number;
  weekly_goal: number;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  modified_at: Date;
}

export interface DailySnapshot {
  snapshot_id: number;
  user_id: number;
  shift_date: string;
  total_hours: number;
  created_at: Date;
  modified_at: Date;
}

export interface IncludedRegion {
  region_id: number;
  region_name: string;
  is_active: boolean;
}

export interface ReportRow {
  user_id: number;
  recruiter_name: string;
  division_id: number;
  division_name: string;
  weekly_goal: number;
  division_order: number;
  recruiter_order: number;
  week_period: string;
  sun_mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  weekly_total: number;
}

export interface WeeklyTotals {
  week_period: string;
  sun_mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  total: number;
  goal: number;
}

// ClearConnect API Types

export interface ClearConnectOrder {
  orderId: string;
  status: string;
  shiftStartTime: string;
  shiftEndTime: string;
  tempId: string;
  firstName: string;
  lastName: string;
  clientId: string;
  clientName: string;
  regionName: string;
  lessLunchMin: string;
}

export interface ClearConnectTemp {
  tempId: string;
  homeRegion: string;
  firstName: string;
  lastName: string;
  staffingSpecialist: string;
  recruiter: string;
}

export interface ClearConnectUser {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface DailyHoursByRecruiter {
  [recruiterId: number]: number;
}

// Request Types

export interface CreateDivisionRequest {
  division_name: string;
  display_order?: number;
}

export interface UpdateDivisionRequest {
  division_id: number;
  division_name?: string;
  display_order?: number;
  is_active?: boolean;
}

export interface CreateRecruiterRequest {
  user_id: number;
  user_name: string;
  division_id: number;
  weekly_goal: number;
  display_order?: number;
}

export interface UpdateRecruiterRequest {
  config_id: number;
  user_name?: string;
  division_id?: number;
  weekly_goal?: number;
  display_order?: number;
  is_active?: boolean;
}

// Unified User Config (single table for both reports)

export interface UserConfig {
  config_id: number;
  user_id: number;
  user_name: string;
  division_id: number;
  role: RecruiterRole;
  title: string | null;
  ats_source: string | null;
  symplr_user_id: number | null;
  bullhorn_user_id: number | null;
  weekly_goal: number;
  on_hours_report: boolean;
  on_stack_ranking: boolean;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  modified_at: Date;
}

export interface CreateUserConfigRequest {
  user_id: number;
  user_name: string;
  division_id: number;
  role?: RecruiterRole;
  title?: string;
  ats_source?: string;
  symplr_user_id?: number;
  bullhorn_user_id?: number;
  weekly_goal?: number;
  on_hours_report?: boolean;
  on_stack_ranking?: boolean;
  display_order?: number;
}

export interface UpdateUserConfigRequest {
  config_id: number;
  user_name?: string;
  division_id?: number;
  role?: RecruiterRole;
  title?: string;
  symplr_user_id?: number | null;
  bullhorn_user_id?: number | null;
  weekly_goal?: number;
  on_hours_report?: boolean;
  on_stack_ranking?: boolean;
  is_active?: boolean;
  display_order?: number;
}

// Stack Ranking Types

export type AtsSystem = 'symplr' | 'bullhorn';

export interface DivisionAtsMapping {
  division_id: number;
  ats_system: AtsSystem;
}

export interface PlacementData {
  recruiter_user_id: number;
  recruiter_name: string;
  division_id: number;
  division_name: string;
  head_count: number;
  total_bill_amount: number;
  total_pay_amount: number;
}

export interface FinancialRow {
  recruiter_user_id: number;
  recruiter_name: string;
  division_name: string;
  head_count: number;
  total_bill: number;
  total_pay: number;
  gross_profit_dollars: number;
  gross_margin_pct: number;
}

export interface FinancialTotals {
  total_head_count: number;
  total_bill: number;
  total_pay: number;
  total_gp_dollars: number;
  overall_gm_pct: number;
}

export interface StackRankingRow {
  rank: number;
  recruiter_name: string;
  recruiter_user_id: number;
  division_name: string;
  head_count: number;
  gross_margin_dollars: number;
  gross_profit_pct: number;
  revenue: number;
  prior_week_rank: number | null;
  rank_change: number | null;
}

export interface StackRankingSnapshot {
  snapshot_id: number;
  week_start: string;
  recruiter_user_id: number;
  recruiter_name: string;
  division_name: string;
  rank: number;
  head_count: number;
  gross_margin_dollars: number;
  gross_profit_pct: number;
  revenue: number;
  created_at: Date;
}

export interface StackRankingTotals {
  total_head_count: number;
  total_gm_dollars: number;
  total_revenue: number;
  overall_gp_pct: number;
}

// App Config Types

export interface AppConfig {
  config_key: string;
  config_value: string;
  description: string | null;
  created_at: Date;
  modified_at: Date;
}
