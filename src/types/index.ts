// Database Types

export interface Division {
  division_id: number;
  division_name: string;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  modified_at: Date;
}

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
