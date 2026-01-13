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

// Database Types
export interface Division {
  division_id: number;
  division_name: string;
  display_order: number;
  is_active: boolean;
}

export interface RecruiterConfig {
  config_id: number;
  user_id: number;
  user_name: string;
  division_id: number;
  weekly_goal: number;
  display_order: number;
  is_active: boolean;
}

export interface DailySnapshot {
  snapshot_id: number;
  user_id: number;
  shift_date: Date;
  total_hours: number;
  snapshot_taken_at: Date;
}

export interface IncludedRegion {
  region_id: number;
  region_name: string | null;
  is_active: boolean;
}

// Report Types
export interface ReportRow {
  division_id: number;
  division_name: string;
  division_order: number;
  user_id: number;
  recruiter_name: string;
  weekly_goal: number;
  recruiter_order: number;
  week_period: 'Last Week' | 'This Week' | 'Next Week';
  sun_mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  weekly_total: number;
}

// Weekly totals from database query
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

// API Request Types
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

// Hours calculation types
export interface DailyHoursByRecruiter {
  [recruiterId: number]: number;
}

// Email Types
export interface EmailRecipient {
  emailAddress: {
    address: string;
  };
}
