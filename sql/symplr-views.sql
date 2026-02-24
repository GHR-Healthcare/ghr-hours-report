-- ============================================================
-- Symplr (ctmsync) SQL Views
-- Run this script against the ghr_ctmsync database
-- ============================================================

-- ============================================================
-- View: vw_FilledOrderFinancials
--
-- Pre-computes per-order financial data including non-taxable pay
-- from the payextra_mapping table. Handles the 4x LEFT JOIN to
-- payextra_mapping so consumers don't have to.
--
-- Used by: getSymplrPlacementData (stack ranking + financials)
-- ============================================================
IF OBJECT_ID('dbo.vw_FilledOrderFinancials', 'V') IS NOT NULL
  DROP VIEW dbo.vw_FilledOrderFinancials;
GO

CREATE VIEW dbo.vw_FilledOrderFinancials
AS
SELECT
  o.orderid,
  o.filledby,
  o.shiftstarttime,
  pt.staffingspecialist,
  pt.recruiter,
  ISNULL(o.totalbillamount, 0) AS total_bill,
  ISNULL(o.totalpayamount, 0) AS total_pay,
  -- Non-taxable pay: sum of extras where extra_pb = 'pay' AND extratax_yn != 'yes'
  CASE WHEN pm1.extra_pb = 'pay' AND pm1.extratax_yn != 'yes' THEN ISNULL(o.extra, 0) ELSE 0 END
  + CASE WHEN pm2.extra_pb = 'pay' AND pm2.extratax_yn != 'yes' THEN ISNULL(o.extra2, 0) ELSE 0 END
  + CASE WHEN pm3.extra_pb = 'pay' AND pm3.extratax_yn != 'yes' THEN ISNULL(o.extra3, 0) ELSE 0 END
  + CASE WHEN pm4.extra_pb = 'pay' AND pm4.extratax_yn != 'yes' THEN ISNULL(o.extra4, 0) ELSE 0 END
  AS non_taxable_pay
FROM dbo.orders o
INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
LEFT JOIN dbo.payextra_mapping pm1 ON o.extra_typeid = pm1.extraid
LEFT JOIN dbo.payextra_mapping pm2 ON o.extra2_typeid = pm2.extraid
LEFT JOIN dbo.payextra_mapping pm3 ON o.extra3_typeid = pm3.extraid
LEFT JOIN dbo.payextra_mapping pm4 ON o.extra4_typeid = pm4.extraid
WHERE o.status = 'filled';
GO


-- ============================================================
-- View: vw_OrderHours
--
-- Per-order hour calculations with lunch deduction from client
-- profile. Includes staffing specialist and day-of-week info.
--
-- Used by: getHoursFromOrders, getLiveHoursByDay
-- ============================================================
IF OBJECT_ID('dbo.vw_OrderHours', 'V') IS NOT NULL
  DROP VIEW dbo.vw_OrderHours;
GO

CREATE VIEW dbo.vw_OrderHours
AS
SELECT
  o.orderid,
  o.filledby,
  o.shiftstarttime,
  pt.staffingspecialist,
  pt.homeregion,
  u.userid,
  u.firstname,
  u.lastname,
  DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) AS shift_minutes,
  ISNULL(pc.defaultlunchmins, 0) AS lunch_minutes,
  DATEDIFF(MINUTE, o.shiftstarttime, o.shiftendtime) - ISNULL(pc.defaultlunchmins, 0) AS net_minutes,
  DATEPART(weekday, o.shiftstarttime) AS day_of_week
FROM dbo.orders o
INNER JOIN dbo.profile_temp pt ON o.filledby = pt.recordid
INNER JOIN dbo.users u ON pt.staffingspecialist = u.userid
LEFT JOIN dbo.profile_client pc ON o.customerid = pc.recordid
WHERE o.status = 'filled';
GO
