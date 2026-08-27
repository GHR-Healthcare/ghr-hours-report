-- ============================================================
-- Hours Report SQL Views
-- Run this script against the hours_report database
-- ============================================================

-- ============================================================
-- View: vw_report_pivoted
--
-- Pivots weekly_snapshots into the hours report format with
-- day-of-week columns. Joins recruiter_config + divisions to
-- provide recruiter name, goal, division, and week period labels.
--
-- recruiter_config is the source of truth for who appears on the
-- report: it is the table the admin portal reads and writes, and
-- the table calculateWeeklyHours filters snapshot writes against.
-- Do NOT point this view at user_config - that table belongs to the
-- abandoned stack-ranking work and is not maintained by this app.
--
-- Used by: getReportData, getWeeklyTotals
-- ============================================================
IF OBJECT_ID('dbo.vw_report_pivoted', 'V') IS NOT NULL
  DROP VIEW dbo.vw_report_pivoted;
GO

CREATE VIEW dbo.vw_report_pivoted
AS
WITH WeekDates AS (
  SELECT
    DATEADD(day, -DATEPART(weekday, GETDATE()) + 1, CAST(GETDATE() AS DATE)) AS this_week_start,
    DATEADD(day, -DATEPART(weekday, GETDATE()) + 1 - 7, CAST(GETDATE() AS DATE)) AS last_week_start,
    DATEADD(day, -DATEPART(weekday, GETDATE()) + 1 + 7, CAST(GETDATE() AS DATE)) AS next_week_start
),
SnapshotData AS (
  SELECT
    ws.user_id,
    ws.week_start,
    ws.day_of_week,
    ws.total_hours,
    -- The weekly total is the most recent snapshot, not the largest one.
    -- Booked hours go down as well as up (cancellations, reassignments), so
    -- MAX() here reported the high-water mark of the week instead of where
    -- the week actually stands.
    MAX(ws.day_of_week) OVER (PARTITION BY ws.user_id, ws.week_start) AS latest_day,
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
  ISNULL(MAX(CASE WHEN sd.day_of_week = sd.latest_day THEN sd.total_hours END), 0) AS weekly_total
FROM dbo.recruiter_config rc
INNER JOIN dbo.divisions d ON rc.division_id = d.division_id
CROSS JOIN (SELECT 'Last Week' AS week_period UNION SELECT 'This Week' UNION SELECT 'Next Week') wp
LEFT JOIN SnapshotData sd ON rc.user_id = sd.user_id AND sd.week_period = wp.week_period
WHERE rc.is_active = 1 AND rc.is_deleted = 0 AND d.is_active = 1
GROUP BY
  rc.user_id, rc.user_name, rc.weekly_goal, rc.display_order,
  d.division_id, d.division_name, d.display_order,
  wp.week_period;
GO

-- ============================================================
-- One-time cleanup: drop snapshot rows belonging to recruiters
-- who are no longer active. Going forward the app deletes these
-- when a recruiter is deactivated or removed.
-- ============================================================
DELETE ws
FROM dbo.weekly_snapshots ws
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.recruiter_config rc
  WHERE rc.user_id = ws.user_id AND rc.is_active = 1 AND rc.is_deleted = 0
);
GO
