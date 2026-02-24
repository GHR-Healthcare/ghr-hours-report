-- ============================================================
-- Hours Report SQL Views
-- Run this script against the hours_report database
-- ============================================================

-- ============================================================
-- View: vw_report_pivoted
--
-- Pivots weekly_snapshots into the hours report format with
-- day-of-week columns. Joins user_config + divisions to provide
-- recruiter name, goal, division, and week period labels.
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
  wp.week_period;
GO
