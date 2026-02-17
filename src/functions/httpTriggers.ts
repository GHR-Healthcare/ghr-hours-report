import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { clearConnectService } from '../services/clearconnect';
import { calculateAllHours } from '../utils/hours-calculator';
import { stackRankingService } from '../services/stackRanking';

// DIVISIONS

app.http('getDivisions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'divisions',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const includeInactive = request.query.get('includeInactive') === 'true';
      const divisions = await databaseService.getDivisions(includeInactive);
      return { jsonBody: divisions };
    } catch (error) {
      context.error('Error getting divisions:', error);
      return { status: 500, jsonBody: { error: 'Failed to get divisions' } };
    }
  }
});

app.http('createDivision', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'divisions',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const division = await databaseService.createDivision(body);
      return { status: 201, jsonBody: division };
    } catch (error) {
      context.error('Error creating division:', error);
      return { status: 500, jsonBody: { error: 'Failed to create division' } };
    }
  }
});

app.http('updateDivision', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'divisions/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = parseInt(request.params.id || '0');
      const body = await request.json() as any;
      const division = await databaseService.updateDivision({ ...body, division_id: id });
      if (!division) {
        return { status: 404, jsonBody: { error: 'Division not found' } };
      }
      return { jsonBody: division };
    } catch (error) {
      context.error('Error updating division:', error);
      return { status: 500, jsonBody: { error: 'Failed to update division' } };
    }
  }
});

// RECRUITERS

app.http('getRecruiters', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recruiters',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const includeInactive = request.query.get('includeInactive') === 'true';
      const recruiters = await databaseService.getRecruiters(includeInactive);
      return { jsonBody: recruiters };
    } catch (error) {
      context.error('Error getting recruiters:', error);
      return { status: 500, jsonBody: { error: 'Failed to get recruiters' } };
    }
  }
});

app.http('getRecruitersByDivision', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'divisions/{id}/recruiters',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const divisionId = parseInt(request.params.id || '0');
      const recruiters = await databaseService.getRecruitersByDivision(divisionId);
      return { jsonBody: recruiters };
    } catch (error) {
      context.error('Error getting recruiters by division:', error);
      return { status: 500, jsonBody: { error: 'Failed to get recruiters' } };
    }
  }
});

app.http('createRecruiter', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'recruiters',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const recruiter = await databaseService.createRecruiter(body);
      return { status: 201, jsonBody: recruiter };
    } catch (error) {
      context.error('Error creating recruiter:', error);
      return { status: 500, jsonBody: { error: 'Failed to create recruiter' } };
    }
  }
});

app.http('updateRecruiter', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = parseInt(request.params.id || '0');
      const body = await request.json() as any;
      const recruiter = await databaseService.updateRecruiter({ ...body, config_id: id });
      if (!recruiter) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      return { jsonBody: recruiter };
    } catch (error) {
      context.error('Error updating recruiter:', error);
      return { status: 500, jsonBody: { error: 'Failed to update recruiter' } };
    }
  }
});

app.http('deleteRecruiter', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = parseInt(request.params.id || '0');
      const deleted = await databaseService.deleteRecruiter(id);
      if (!deleted) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      return { status: 204 };
    } catch (error) {
      context.error('Error deleting recruiter:', error);
      return { status: 500, jsonBody: { error: 'Failed to delete recruiter' } };
    }
  }
});

// REGIONS

app.http('getRegions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'regions',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const regions = await databaseService.getIncludedRegions();
      return { jsonBody: regions };
    } catch (error) {
      context.error('Error getting regions:', error);
      return { status: 500, jsonBody: { error: 'Failed to get regions' } };
    }
  }
});

// REPORT DATA

app.http('getReportData', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'report',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const weekPeriod = request.query.get('weekPeriod');
      const reportData = await databaseService.getReportData(weekPeriod || undefined);
      const weeklyTotals = await databaseService.getWeeklyTotals();
      
      return { 
        jsonBody: { 
          reportData, 
          weeklyTotals 
        } 
      };
    } catch (error) {
      context.error('Error getting report data:', error);
      return { status: 500, jsonBody: { error: 'Failed to get report data' } };
    }
  }
});

app.http('getReportHtml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'report/html',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const includeLastWeek = request.query.get('includeLastWeek') === 'true';
      const reportData = await databaseService.getReportData();
      const weeklyTotals = await databaseService.getWeeklyTotals();
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek);
      
      return { 
        body: html,
        headers: { 'Content-Type': 'text/html' }
      };
    } catch (error) {
      context.error('Error generating report HTML:', error);
      return { status: 500, jsonBody: { error: 'Failed to generate report' } };
    }
  }
});

// MANUAL TRIGGERS

app.http('triggerCalculation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'calculate',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      context.log('Manual calculation triggered');
      const result = await calculateAllHours();
      return { jsonBody: result };
    } catch (error) {
      context.error('Error in manual calculation:', error);
      return { status: 500, jsonBody: { error: 'Failed to calculate hours' } };
    }
  }
});

// Calculate weekly totals - this is the main calculation used for reports
// It calculates total hours for the entire week (Sun-Sat) for last week, this week and next week
// Only updates the current day's snapshot slot, preserving previous days
// Now queries orders table directly instead of using ClearConnect API
app.http('calculateWeekly', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'calculate/weekly',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const now = new Date();
      
      // Determine current day of week for snapshot slot (0=Sun/Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat)
      const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, etc.
      let snapshotDayOfWeek: number;
      if (currentDayOfWeek === 0 || currentDayOfWeek === 1) {
        snapshotDayOfWeek = 0; // Sun/Mon
      } else {
        snapshotDayOfWeek = currentDayOfWeek - 1; // Tue=1, Wed=2, Thu=3, Fri=4, Sat=5
      }
      
      // Calculate week boundaries
      // This week: Sunday to Saturday
      const thisWeekSunday = new Date(now);
      thisWeekSunday.setDate(now.getDate() - currentDayOfWeek);
      thisWeekSunday.setHours(0, 0, 0, 0);
      
      const thisWeekSaturday = new Date(thisWeekSunday);
      thisWeekSaturday.setDate(thisWeekSunday.getDate() + 6);
      
      // Next week: following Sunday to Saturday
      const nextWeekSunday = new Date(thisWeekSunday);
      nextWeekSunday.setDate(thisWeekSunday.getDate() + 7);
      
      const nextWeekSaturday = new Date(nextWeekSunday);
      nextWeekSaturday.setDate(nextWeekSunday.getDate() + 6);
      
      // Last week: previous Sunday to Saturday
      const lastWeekSunday = new Date(thisWeekSunday);
      lastWeekSunday.setDate(thisWeekSunday.getDate() - 7);
      
      const lastWeekSaturday = new Date(lastWeekSunday);
      lastWeekSaturday.setDate(lastWeekSunday.getDate() + 6);
      
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      
      context.log(`Calculating weekly hours...`);
      context.log(`Last week: ${formatDate(lastWeekSunday)} to ${formatDate(lastWeekSaturday)}`);
      context.log(`This week: ${formatDate(thisWeekSunday)} to ${formatDate(thisWeekSaturday)}`);
      context.log(`Next week: ${formatDate(nextWeekSunday)} to ${formatDate(nextWeekSaturday)}`);
      context.log(`Snapshot day of week: ${snapshotDayOfWeek} (${['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][snapshotDayOfWeek]})`);
      
      // Get active, non-deleted recruiters only
      const activeRecruiters = await databaseService.getRecruiters(false);
      const activeUserIds = new Set(activeRecruiters.map(r => r.user_id));
      const recruiterNames = new Map(activeRecruiters.map(r => [r.user_id, r.user_name]));
      context.log(`Found ${activeUserIds.size} active recruiters`);
      
      const results: any = {
        lastWeek: { weekStart: formatDate(lastWeekSunday), weekEnd: formatDate(lastWeekSaturday), totalOrders: 0, totalHours: 0, recruiters: [] as any[] },
        thisWeek: { weekStart: formatDate(thisWeekSunday), weekEnd: formatDate(thisWeekSaturday), totalOrders: 0, totalHours: 0, recruiters: [] as any[] },
        nextWeek: { weekStart: formatDate(nextWeekSunday), weekEnd: formatDate(nextWeekSaturday), totalOrders: 0, totalHours: 0, recruiters: [] as any[] }
      };
      const newRecruiters: any[] = [];
      const allRegionNames = new Set<string>();
      
      // Process all three weeks
      const weeksToProcess: Array<[string, Date, Date]> = [
        ['lastWeek', lastWeekSunday, lastWeekSaturday],
        ['thisWeek', thisWeekSunday, thisWeekSaturday],
        ['nextWeek', nextWeekSunday, nextWeekSaturday]
      ];
      
      for (const [weekName, weekSunday, weekSaturday] of weeksToProcess) {
        const weekStart = formatDate(weekSunday as Date);
        const weekEnd = formatDate(weekSaturday as Date);
        
        context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}`);

        // Query orders directly from database - much faster and more accurate
        const { hoursMap: hoursByRecruiter, lunchMinutesMap, orderCount, regionNames } = await databaseService.getHoursFromOrders(weekStart, weekEnd);

        // Collect all region names across all weeks
        regionNames.forEach(name => allRegionNames.add(name));

        context.log(`${weekName}: Found ${orderCount} orders for ${hoursByRecruiter.size} staffers`);
        results[weekName].totalOrders = orderCount;
        
        // Check for new recruiters and auto-add them
        for (const [userId, hours] of hoursByRecruiter) {
          if (!activeUserIds.has(userId)) {
            // Check if recruiter exists at all (including deleted/inactive)
            const exists = await databaseService.recruiterExists(userId);
            if (!exists) {
              // Auto-add new recruiter - they'll be active by default
              try {
                const userName = await databaseService.getUserNameFromCtmsync(userId);
                const name = userName || `User ${userId}`;
                
                await databaseService.createRecruiter({
                  user_id: userId,
                  user_name: name,
                  division_id: 1,
                  weekly_goal: 0,
                  display_order: 99
                });

                // Add to active set so their hours get counted
                activeUserIds.add(userId);
                recruiterNames.set(userId, name);
                newRecruiters.push({ userId, name });
                context.log(`Auto-added recruiter: ${name} (ID: ${userId})`);
              } catch (addError) {
                context.log(`Error adding recruiter ${userId}: ${addError}`);
              }
            }
          }
        }
        
        // Round and save snapshots - ONLY for active recruiters
        let totalHoursForWeek = 0;
        const recruiterDetails: any[] = [];

        for (const [userId, hours] of hoursByRecruiter) {
          if (activeUserIds.has(userId)) {
            const roundedHours = Math.round(hours * 100) / 100;
            const lunchMinutes = Math.round(lunchMinutesMap.get(userId) || 0);
            totalHoursForWeek += roundedHours;

            recruiterDetails.push({
              userId,
              name: recruiterNames.get(userId) || `User ${userId}`,
              hours: roundedHours,
              lunchMinutes: lunchMinutes
            });

            await databaseService.upsertWeeklySnapshot(
              userId,
              weekStart,
              snapshotDayOfWeek,
              roundedHours
            );
          }
        }
        
        // Sort by hours descending
        recruiterDetails.sort((a, b) => b.hours - a.hours);
        
        results[weekName].totalHours = Math.round(totalHoursForWeek * 100) / 100;
        results[weekName].recruiters = recruiterDetails;
      }
      
      return { 
        jsonBody: { 
          calculatedAt: now.toISOString(),
          snapshotDayOfWeek,
          snapshotDayName: ['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][snapshotDayOfWeek],
          regionsWithFilledOrders: [...allRegionNames].sort(),
          newRecruitersAdded: newRecruiters,
          results
        } 
      };
    } catch (error) {
      context.error('Error calculating weekly:', error);
      return { status: 500, jsonBody: { error: 'Failed to calculate', details: String(error) } };
    }
  }
});

// Legacy endpoint - keeping for backward compatibility
app.http('calculateDay', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'calculate/day',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    // Redirect to weekly calculation
    context.log('calculateDay is deprecated, redirecting to calculateWeekly');
    return { 
      status: 301, 
      jsonBody: { message: 'Use /api/calculate/weekly instead' } 
    };
  }
});

// Legacy endpoint - redirect to weekly calculation
app.http('calculateRange', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'calculate/range',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    context.log('calculateRange is deprecated, use calculateWeekly instead');
    return { 
      status: 301, 
      jsonBody: { message: 'Use /api/calculate/weekly instead' } 
    };
  }
});

app.http('triggerEmail', {
  methods: ['POST', 'GET'],
  authLevel: 'anonymous',
  route: 'send-email',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      let includeLastWeek = true; // Default to including last week
      let emailType = 'daily';
      
      try {
        const body = await request.json() as any;
        if (body) {
          if (body.includeLastWeek !== undefined) {
            includeLastWeek = body.includeLastWeek === true;
          }
          if (body.emailType) {
            emailType = body.emailType;
          }
        }
      } catch {
        // No body or invalid JSON - use defaults
      }
      
      // For Monday recap, use week offset -1 to shift perspective back one week
      let reportData;
      let weeklyTotals;
      
      if (emailType === 'monday') {
        reportData = await databaseService.getReportDataWithOffset(-1);
        weeklyTotals = await databaseService.getWeeklyTotalsWithOffset(-1);
      } else {
        reportData = await databaseService.getReportData();
        weeklyTotals = await databaseService.getWeeklyTotals();
      }
      
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek);
      
      const recipients = (process.env.EMAIL_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
      
      let subject: string;
      if (emailType === 'monday') {
        subject = 'Weekly Hours Recap - Previous Week Final';
      } else {
        subject = 'Daily Hours Report';
      }
      
      await emailService.sendEmail(recipients, subject, html);
      
      return { jsonBody: { success: true, recipients: recipients.length, emailType, subject } };
    } catch (error) {
      context.error('Error sending email:', error);
      return { status: 500, jsonBody: { error: 'Failed to send email' } };
    }
  }
});

// Test email endpoint - send to custom recipient
app.http('sendTestEmail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'send-test-email',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const { recipient, includeLastWeek, emailType } = body;
      
      if (!recipient) {
        return { status: 400, jsonBody: { error: 'recipient is required' } };
      }
      
      // For Monday recap, use week offset -1 to shift perspective back one week
      let reportData;
      let weeklyTotals;
      
      if (emailType === 'monday') {
        reportData = await databaseService.getReportDataWithOffset(-1);
        weeklyTotals = await databaseService.getWeeklyTotalsWithOffset(-1);
      } else {
        reportData = await databaseService.getReportData();
        weeklyTotals = await databaseService.getWeeklyTotals();
      }
      
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek === true);
      
      let subject: string;
      if (emailType === 'monday') {
        subject = '[TEST] Weekly Hours Recap - Previous Week Final';
      } else {
        subject = '[TEST] Daily Hours Report';
      }
      
      await emailService.sendEmail([recipient], subject, html);
      
      return { jsonBody: { success: true, recipient, emailType: emailType || 'daily' } };
    } catch (error) {
      context.error('Error sending test email:', error);
      return { status: 500, jsonBody: { error: 'Failed to send test email', details: String(error) } };
    }
  }
});

// Serve admin portal
app.http('adminPortal', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'portal',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GHR Hours Report - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
    .header { background: #2563eb; color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header h1 { font-size: 1.5rem; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    .tabs { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .tab { padding: 0.75rem 1.5rem; background: white; border: none; border-radius: 8px 8px 0 0; cursor: pointer; font-size: 1rem; color: #666; }
    .tab.active { background: #2563eb; color: white; }
    .panel { background: white; border-radius: 0 8px 8px 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: none; }
    .panel.active { display: block; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f9fafb; font-weight: 600; color: #374151; }
    tr:hover { background: #f9fafb; }
    .btn { padding: 0.5rem 1rem; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem; transition: all 0.2s; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { background: #e5e7eb; color: #374151; }
    .btn-secondary:hover { background: #d1d5db; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: #10b981; color: white; }
    .btn-success:hover { background: #059669; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; color: #374151; }
    .form-group input, .form-group select { width: 100%; padding: 0.625rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 1rem; }
    .form-group input:focus, .form-group select:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; z-index: 1000; }
    .modal.active { display: flex; }
    .modal-content { background: white; border-radius: 12px; padding: 1.5rem; width: 100%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .modal-header h2 { font-size: 1.25rem; }
    .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #9ca3af; }
    .alert { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; }
    .alert-success { background: #d1fae5; color: #065f46; }
    .alert-error { background: #fee2e2; color: #991b1b; }
    .card { background: #f9fafb; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
    .card h3 { margin-bottom: 1rem; color: #374151; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1rem; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #2563eb; }
    .stat-label { font-size: 0.875rem; color: #6b7280; }
    .actions { display: flex; gap: 0.5rem; }
    .loading { opacity: 0.6; pointer-events: none; }
    .inline-edit { display: flex; gap: 0.5rem; align-items: center; }
    .inline-edit input { width: 80px; padding: 0.25rem 0.5rem; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
    .badge-active { background: #d1fae5; color: #065f46; }
    .badge-inactive { background: #fee2e2; color: #991b1b; }
    .email-options { display: flex; gap: 1rem; margin-bottom: 1rem; }
    .email-option { flex: 1; padding: 1rem; border: 2px solid #e5e7eb; border-radius: 8px; cursor: pointer; text-align: center; }
    .email-option:hover { border-color: #2563eb; }
    .email-option.selected { border-color: #2563eb; background: #eff6ff; }
    .email-option h4 { margin-bottom: 0.5rem; }
    .email-option p { font-size: 0.875rem; color: #6b7280; }
    .preview-frame { border: 1px solid #e5e7eb; border-radius: 8px; height: 500px; width: 100%; }
    .sub-tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 2px solid #e5e7eb; }
    .sub-tab { padding: 0.5rem 1.25rem; background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; cursor: pointer; font-size: 0.9rem; color: #6b7280; font-weight: 500; transition: all 0.2s; }
    .sub-tab:hover { color: #374151; }
    .sub-tab.active { color: #2563eb; border-bottom-color: #2563eb; }
    .sub-panel { display: none; }
    .sub-panel.active { display: block; }
  </style>
</head>
<body>
  <div class="header">
    <h1>GHR Hours Report Admin</h1>
    <span id="lastUpdated"></span>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" data-tab="hours-report">Hours Report</button>
      <button class="tab" data-tab="stack-ranking">Stack Ranking</button>
      <button class="tab" data-tab="financials">Financials</button>
      <button class="tab" data-tab="user-admin">User Admin</button>
    </div>

    <div id="alert"></div>

    <!-- Hours Report Panel -->
    <div class="panel active" id="hours-report-panel">
      <h2>Hours Report</h2>
      <div class="sub-tabs">
        <button class="sub-tab active" data-subtab="hr-recalc" data-group="hr">Recalculate</button>
        <button class="sub-tab" data-subtab="hr-preview" data-group="hr">Preview</button>
        <button class="sub-tab" data-subtab="hr-email" data-group="hr">Email</button>
      </div>

      <div class="sub-panel active" id="hr-recalc">
        <div class="card">
          <h3>Recalculate</h3>
          <p style="color: #6b7280; margin-bottom: 1rem;">Re-fetch hours from orders for last week, this week, and next week.</p>
          <button class="btn btn-primary" onclick="runCalculation()" id="calc-btn">Run Weekly Calculation</button>
          <div id="calc-results" style="margin-top: 1rem;"></div>
        </div>
      </div>

      <div class="sub-panel" id="hr-preview">
        <div class="card">
          <h3>Preview Report</h3>
          <button class="btn btn-secondary" onclick="loadPreview(true)">Preview Report</button>
          <iframe id="preview-frame" class="preview-frame" style="margin-top: 1rem;"></iframe>
        </div>
      </div>

      <div class="sub-panel" id="hr-email">
        <div class="card">
          <h3>Send Email</h3>
          <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
            <button class="btn btn-primary" onclick="sendLiveEmail('daily')">Send Daily Report to All</button>
            <button class="btn btn-primary" onclick="sendLiveEmail('monday')" style="background: #7c3aed;">Send Monday Recap to All</button>
          </div>
          <hr style="margin: 1rem 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; margin-bottom: 0.5rem;">Test email to a single address:</p>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input type="email" id="test-email-recipient" placeholder="your.email@ghrhealthcare.com" style="flex:1;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;">
            <div class="email-options" style="margin:0;">
              <div class="email-option selected" data-type="daily" onclick="selectEmailType('daily')" style="padding:0.5rem 1rem;">
                <strong>Daily</strong>
              </div>
              <div class="email-option" data-type="monday" onclick="selectEmailType('monday')" style="padding:0.5rem 1rem;">
                <strong>Monday</strong>
              </div>
            </div>
            <button class="btn btn-secondary" onclick="sendTestEmail()" id="send-test-btn">Send Test</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Stack Ranking Panel -->
    <div class="panel" id="stack-ranking-panel">
      <h2>Stack Ranking</h2>
      <p style="color: #6b7280; margin-bottom: 1rem;">Data is typically ~2 weeks behind (Sun-Sat billing cycle).</p>
      <div class="sub-tabs">
        <button class="sub-tab active" data-subtab="sr-recalc" data-group="sr">Recalculate</button>
        <button class="sub-tab" data-subtab="sr-preview" data-group="sr">Preview</button>
        <button class="sub-tab" data-subtab="sr-email" data-group="sr">Email</button>
      </div>

      <div class="sub-panel active" id="sr-recalc">
        <div class="card">
          <h3>Calculate Ranking</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Week Start:</label>
            <input type="date" id="sr-week-start" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
            <label style="font-size: 0.875rem; color: #6b7280;">Week End:</label>
            <input type="date" id="sr-week-end" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
            <button class="btn btn-primary" onclick="loadStackRanking()">Calculate</button>
          </div>
          <div id="sr-results"></div>
        </div>
      </div>

      <div class="sub-panel" id="sr-preview">
        <div class="card">
          <h3>Preview Report</h3>
          <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">
            <label style="font-size: 0.875rem; color: #6b7280;">Week Start:</label>
            <input type="date" id="sr-prev-week-start" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
            <label style="font-size: 0.875rem; color: #6b7280;">Week End:</label>
            <input type="date" id="sr-prev-week-end" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
            <button class="btn btn-secondary" onclick="previewStackRankingHtml()">Preview HTML</button>
          </div>
          <iframe id="sr-preview-frame" class="preview-frame" style="margin-top:1rem;"></iframe>
        </div>
      </div>

      <div class="sub-panel" id="sr-email">
        <div class="card">
          <h3>Send Stack Ranking Email</h3>
          <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
            <button class="btn btn-primary" onclick="sendStackRankingEmail()">Send to All Recipients</button>
          </div>
          <hr style="margin: 1rem 0; border: none; border-top: 1px solid #e5e7eb;">
          <p style="color: #6b7280; margin-bottom: 0.5rem;">Test email to a single address:</p>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <input type="email" id="sr-test-email" placeholder="your.email@ghrhealthcare.com" style="flex:1;padding:0.5rem;border:1px solid #d1d5db;border-radius:6px;">
            <button class="btn btn-secondary" onclick="sendStackRankingTestEmail()" id="sr-send-test-btn">Send Test</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Financials Panel -->
    <div class="panel" id="financials-panel">
      <h2>Financials</h2>
      <p style="color: #6b7280; margin-bottom: 1rem;">View pay/bill data by user. Uses the same placement data as stack ranking.</p>

      <div class="card">
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;">
          <label style="font-size: 0.875rem; color: #6b7280;">Week Start:</label>
          <input type="date" id="fin-week-start" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
          <label style="font-size: 0.875rem; color: #6b7280;">Week End:</label>
          <input type="date" id="fin-week-end" style="padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 4px;">
          <button class="btn btn-primary" onclick="loadFinancials()">Load Data</button>
        </div>
        <div id="fin-results"></div>
      </div>
    </div>

    <!-- User Admin Panel -->
    <div class="panel" id="user-admin-panel">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h2>User Admin</h2>
        <button class="btn btn-primary" onclick="openAddUserModal()">+ Add User</button>
      </div>

      <div class="stats" id="user-stats"></div>

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>User ID</th>
            <th>Title</th>
            <th>Role</th>
            <th>Division</th>
            <th>Weekly Goal</th>
            <th>Hours Rpt</th>
            <th>Stack Rank</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="users-table"></tbody>
      </table>
    </div>
  </div>

  <!-- Add/Edit User Modal -->
  <div class="modal" id="user-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">Add User</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <form id="user-form">
        <input type="hidden" id="edit-config-id">
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="edit-name" required>
        </div>
        <div class="form-group">
          <label>User ID</label>
          <input type="number" id="edit-user-id" required>
        </div>
        <div class="form-group">
          <label>Title</label>
          <input type="text" id="edit-title">
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="edit-role">
            <option value="recruiter">Recruiter</option>
            <option value="account_manager">Account Manager</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div class="form-group">
          <label>Division</label>
          <select id="edit-division"></select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Weekly Goal (hours)</label>
            <input type="number" id="edit-goal" value="0" min="0">
          </div>
          <div class="form-group">
            <label>Display Order</label>
            <input type="number" id="edit-order" value="99" min="0">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label><input type="checkbox" id="edit-hours-report"> On Hours Report</label>
          </div>
          <div class="form-group">
            <label><input type="checkbox" id="edit-stack-ranking"> On Stack Ranking</label>
          </div>
        </div>
        <div class="form-group">
          <label><input type="checkbox" id="edit-active" checked> Active</label>
        </div>
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1.5rem;">
          <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const API_BASE = window.location.origin + '/api';
    let divisions = [];
    let users = [];
    let selectedEmailType = 'daily';

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-panel').classList.add('active');

        if (tab.dataset.tab === 'stack-ranking') {
          getStackRankingDates();
        }
        if (tab.dataset.tab === 'financials') {
          getFinancialsDates();
        }
        if (tab.dataset.tab === 'user-admin') {
          loadUsers();
        }
      });
    });

    // Sub-tab switching
    document.querySelectorAll('.sub-tab').forEach(function(stab) {
      stab.addEventListener('click', function() {
        var group = stab.dataset.group;
        document.querySelectorAll('.sub-tab[data-group="' + group + '"]').forEach(function(t) { t.classList.remove('active'); });
        stab.classList.add('active');
        // Hide all sub-panels in this group's parent panel
        var parentPanel = stab.closest('.panel');
        parentPanel.querySelectorAll('.sub-panel').forEach(function(p) { p.classList.remove('active'); });
        document.getElementById(stab.dataset.subtab).classList.add('active');

        // Sync dates when switching SR sub-tabs
        if (group === 'sr') {
          syncSRDates();
        }
      });
    });

    // Alert display
    function showAlert(message, type) {
      type = type || 'success';
      var alertEl = document.getElementById('alert');
      alertEl.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
      setTimeout(function() { alertEl.innerHTML = ''; }, 5000);
    }

    // Load divisions
    async function loadDivisions() {
      const res = await fetch(API_BASE + '/divisions');
      divisions = await res.json();
      const select = document.getElementById('edit-division');
      select.innerHTML = divisions.map(function(d) {
        return '<option value="' + d.division_id + '">' + d.division_name + '</option>';
      }).join('');
    }

    // =========== HOURS REPORT ===========

    function selectEmailType(type) {
      selectedEmailType = type;
      document.querySelectorAll('.email-option').forEach(function(el) {
        el.classList.toggle('selected', el.dataset.type === type);
      });
    }

    async function sendLiveEmail(type) {
      var confirmMsg = type === 'monday'
        ? 'Send the Monday Recap email to ALL configured recipients?'
        : 'Send the Daily Report email to ALL configured recipients?';
      if (!confirm(confirmMsg)) return;

      var btn = event.target;
      var originalText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;

      try {
        var res = await fetch(API_BASE + '/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ includeLastWeek: true, emailType: type })
        });
        var data = await res.json();
        if (res.ok) {
          showAlert('Email sent to ' + data.recipients + ' recipients!');
        } else {
          showAlert('Error: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showAlert('Error sending email: ' + err.message, 'error');
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }

    async function sendTestEmail() {
      var recipient = document.getElementById('test-email-recipient').value;
      if (!recipient) { showAlert('Please enter a recipient email', 'error'); return; }

      var btn = document.getElementById('send-test-btn');
      btn.textContent = 'Sending...';
      btn.disabled = true;

      try {
        var res = await fetch(API_BASE + '/send-test-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: recipient, includeLastWeek: true, emailType: selectedEmailType })
        });
        var data = await res.json();
        if (res.ok) {
          showAlert('Test email sent to ' + recipient + ' (' + (selectedEmailType === 'monday' ? 'Monday Recap' : 'Daily Report') + ')');
        } else {
          showAlert('Error: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showAlert('Error sending email: ' + err.message, 'error');
      } finally {
        btn.textContent = 'Send Test';
        btn.disabled = false;
      }
    }

    function loadPreview(includeLastWeek) {
      var frame = document.getElementById('preview-frame');
      frame.src = API_BASE + '/report/html?includeLastWeek=' + includeLastWeek + '&t=' + Date.now();
    }

    function renderCalculationResults(data) {
      var html = '<h4>Results</h4>';
      html += '<p>Calculated at: ' + new Date(data.calculatedAt).toLocaleString() + '</p>';
      html += '<p>Snapshot day: ' + data.snapshotDayName + '</p>';
      if (data.regionsWithFilledOrders && data.regionsWithFilledOrders.length > 0) {
        html += '<p><strong>Regions:</strong> ' + data.regionsWithFilledOrders.join(', ') + '</p>';
      }
      if (data.newRecruitersAdded && data.newRecruitersAdded.length > 0) {
        html += '<p style="color:#4CAF50;"><strong>New users added:</strong> ' + data.newRecruitersAdded.map(function(r) { return r.name; }).join(', ') + '</p>';
      }
      html += '<table><thead><tr><th>Week</th><th>Date Range</th><th>Orders</th><th>Users</th><th>Total Hours</th></tr></thead><tbody>';
      for (var weekName in data.results) {
        var week = data.results[weekName];
        html += '<tr><td>' + weekName + '</td><td>' + week.weekStart + ' to ' + week.weekEnd + '</td><td>' +
          week.totalOrders + '</td><td>' + week.recruiters.length + '</td><td><strong>' + week.totalHours.toLocaleString() + '</strong></td></tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    function loadLastCalculation() {
      var results = document.getElementById('calc-results');
      var saved = localStorage.getItem('ghr-last-calculation');
      if (saved) {
        try { results.innerHTML = renderCalculationResults(JSON.parse(saved)); }
        catch (e) { results.innerHTML = '<p>No previous calculation results.</p>'; }
      } else {
        results.innerHTML = '<p>No previous results. Click "Run Weekly Calculation" to fetch data.</p>';
      }
    }

    async function runCalculation() {
      var btn = document.getElementById('calc-btn');
      var results = document.getElementById('calc-results');
      btn.textContent = 'Running...';
      btn.disabled = true;
      results.innerHTML = '<p>Calculating weekly hours... this may take several minutes.</p>';

      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, 600000);
        var res = await fetch(API_BASE + '/calculate/weekly', { signal: controller.signal });
        clearTimeout(timeoutId);
        var data = await res.json();
        if (res.ok) {
          localStorage.setItem('ghr-last-calculation', JSON.stringify(data));
          results.innerHTML = renderCalculationResults(data);
          showAlert('Calculation complete!');
        } else {
          results.innerHTML = '<p class="alert alert-error">Error: ' + (data.error || 'Unknown error') + '</p>';
        }
      } catch (err) {
        results.innerHTML = '<p class="alert alert-error">Error: ' + err.message + '</p>';
      } finally {
        btn.textContent = 'Run Weekly Calculation';
        btn.disabled = false;
      }
    }

    // =========== STACK RANKING ===========

    function getDefaultSRDates() {
      var now = new Date();
      var dayOfWeek = now.getDay();
      var thisSun = new Date(now);
      thisSun.setDate(now.getDate() - dayOfWeek);
      var targetSun = new Date(thisSun);
      targetSun.setDate(thisSun.getDate() - 14);
      var targetSat = new Date(targetSun);
      targetSat.setDate(targetSun.getDate() + 6);
      return { weekStart: targetSun.toISOString().split('T')[0], weekEnd: targetSat.toISOString().split('T')[0] };
    }

    function getStackRankingDates() {
      var weekStart = document.getElementById('sr-week-start').value;
      var weekEnd = document.getElementById('sr-week-end').value;
      if (!weekStart || !weekEnd) {
        var defaults = getDefaultSRDates();
        weekStart = defaults.weekStart;
        weekEnd = defaults.weekEnd;
        document.getElementById('sr-week-start').value = weekStart;
        document.getElementById('sr-week-end').value = weekEnd;
        document.getElementById('sr-prev-week-start').value = weekStart;
        document.getElementById('sr-prev-week-end').value = weekEnd;
      }
      return { weekStart: weekStart, weekEnd: weekEnd };
    }

    function syncSRDates() {
      // Sync dates across all SR sub-tab date pickers
      var recalcStart = document.getElementById('sr-week-start').value;
      var recalcEnd = document.getElementById('sr-week-end').value;
      var prevStart = document.getElementById('sr-prev-week-start').value;
      var prevEnd = document.getElementById('sr-prev-week-end').value;
      // Use whichever has values; prefer recalc
      if (recalcStart && recalcEnd) {
        document.getElementById('sr-prev-week-start').value = recalcStart;
        document.getElementById('sr-prev-week-end').value = recalcEnd;
      } else if (prevStart && prevEnd) {
        document.getElementById('sr-week-start').value = prevStart;
        document.getElementById('sr-week-end').value = prevEnd;
      }
    }

    async function loadStackRanking() {
      var dates = getStackRankingDates();
      var results = document.getElementById('sr-results');
      document.getElementById('sr-preview-frame').style.display = 'none';
      results.innerHTML = '<p>Calculating stack ranking...</p>';

      try {
        var res = await fetch(API_BASE + '/stack-ranking?weekStart=' + dates.weekStart + '&weekEnd=' + dates.weekEnd);
        var data = await res.json();
        if (data.error) { results.innerHTML = '<p class="alert alert-error">' + data.error + '</p>'; return; }

        var rows = data.rows || [];
        var totals = data.totals || {};
        var fmtMoney = function(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        var fmtPct = function(n) { return (n || 0).toFixed(2) + '%'; };

        var html = '<p style="color:#6b7280;margin-bottom:1rem;">' + rows.length + ' ranked for ' + dates.weekStart + ' to ' + dates.weekEnd + '</p>';
        html += '<table><thead><tr><th>Rank</th><th>Name</th><th>Division</th><th>HC</th><th>GM$</th><th>GP%</th><th>Revenue</th><th>Change</th><th>Prior</th></tr></thead><tbody>';
        rows.forEach(function(r) {
          var change = r.rank_change === null ? 'NEW' : r.rank_change > 0 ? '+' + r.rank_change : r.rank_change === 0 ? '-' : '' + r.rank_change;
          var prior = r.prior_week_rank !== null ? r.prior_week_rank : 'NEW';
          html += '<tr><td>' + r.rank + '</td><td>' + r.recruiter_name + '</td><td>' + r.division_name + '</td>' +
            '<td style="text-align:right">' + r.head_count + '</td><td style="text-align:right">' + fmtMoney(r.gross_margin_dollars) + '</td>' +
            '<td style="text-align:right">' + fmtPct(r.gross_profit_pct) + '</td><td style="text-align:right">' + fmtMoney(r.revenue) + '</td>' +
            '<td style="text-align:center">' + change + '</td><td style="text-align:center">' + prior + '</td></tr>';
        });
        html += '<tr style="font-weight:bold;background:#f0f0f0;"><td></td><td>TOTALS</td><td></td>' +
          '<td style="text-align:right">' + (totals.total_head_count || 0) + '</td>' +
          '<td style="text-align:right">' + fmtMoney(totals.total_gm_dollars) + '</td>' +
          '<td style="text-align:right">' + fmtPct(totals.overall_gp_pct) + '</td>' +
          '<td style="text-align:right">' + fmtMoney(totals.total_revenue) + '</td><td></td><td></td></tr>';
        html += '</tbody></table>';
        results.innerHTML = html;
      } catch (err) {
        results.innerHTML = '<p class="alert alert-error">Error: ' + err.message + '</p>';
      }
    }

    function previewStackRankingHtml() {
      var weekStart = document.getElementById('sr-prev-week-start').value;
      var weekEnd = document.getElementById('sr-prev-week-end').value;
      if (!weekStart || !weekEnd) {
        var defaults = getDefaultSRDates();
        weekStart = defaults.weekStart;
        weekEnd = defaults.weekEnd;
        document.getElementById('sr-prev-week-start').value = weekStart;
        document.getElementById('sr-prev-week-end').value = weekEnd;
      }
      var frame = document.getElementById('sr-preview-frame');
      frame.src = API_BASE + '/stack-ranking/html?weekStart=' + weekStart + '&weekEnd=' + weekEnd;
    }

    async function sendStackRankingEmail() {
      if (!confirm('Send the Stack Ranking email to ALL configured recipients?')) return;
      var dates = getStackRankingDates();
      try {
        var res = await fetch(API_BASE + '/stack-ranking/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekStart: dates.weekStart, weekEnd: dates.weekEnd })
        });
        var data = await res.json();
        if (res.ok) { showAlert('Stack ranking email sent to ' + data.recipientCount + ' recipients!'); }
        else { showAlert('Error: ' + (data.error || 'Unknown error'), 'error'); }
      } catch (err) { showAlert('Error: ' + err.message, 'error'); }
    }

    async function sendStackRankingTestEmail() {
      var recipient = document.getElementById('sr-test-email').value;
      if (!recipient) { showAlert('Please enter a recipient email', 'error'); return; }
      var btn = document.getElementById('sr-send-test-btn');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      var dates = getStackRankingDates();
      try {
        var res = await fetch(API_BASE + '/stack-ranking/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekStart: dates.weekStart, weekEnd: dates.weekEnd, recipient: recipient })
        });
        var data = await res.json();
        if (res.ok) { showAlert('Test email sent to ' + recipient); }
        else { showAlert('Error: ' + (data.error || 'Unknown error'), 'error'); }
      } catch (err) { showAlert('Error: ' + err.message, 'error'); }
      finally { btn.textContent = 'Send Test'; btn.disabled = false; }
    }

    // =========== FINANCIALS ===========

    function getFinancialsDates() {
      var weekStart = document.getElementById('fin-week-start').value;
      var weekEnd = document.getElementById('fin-week-end').value;
      if (!weekStart || !weekEnd) {
        var now = new Date();
        var dayOfWeek = now.getDay();
        var thisSun = new Date(now);
        thisSun.setDate(now.getDate() - dayOfWeek);
        var targetSun = new Date(thisSun);
        targetSun.setDate(thisSun.getDate() - 14);
        var targetSat = new Date(targetSun);
        targetSat.setDate(targetSun.getDate() + 6);
        weekStart = targetSun.toISOString().split('T')[0];
        weekEnd = targetSat.toISOString().split('T')[0];
        document.getElementById('fin-week-start').value = weekStart;
        document.getElementById('fin-week-end').value = weekEnd;
      }
      return { weekStart: weekStart, weekEnd: weekEnd };
    }

    async function loadFinancials() {
      var dates = getFinancialsDates();
      var results = document.getElementById('fin-results');
      results.innerHTML = '<p>Loading financial data...</p>';

      try {
        var res = await fetch(API_BASE + '/financials?weekStart=' + dates.weekStart + '&weekEnd=' + dates.weekEnd);
        var data = await res.json();
        if (data.error) { results.innerHTML = '<p class="alert alert-error">' + data.error + '</p>'; return; }

        var rows = data.rows || [];
        var totals = data.totals || {};
        var fmtMoney = function(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        var fmtPct = function(n) { return (n || 0).toFixed(2) + '%'; };

        var html = '<p style="color:#6b7280;margin-bottom:1rem;">Week of ' + dates.weekStart + ' to ' + dates.weekEnd + ' &mdash; ' + rows.length + ' users</p>';
        html += '<table><thead><tr><th>Name</th><th>Division</th><th>HC</th><th>Total Bill</th><th>Total Pay</th><th>GP$</th><th>GM%</th></tr></thead><tbody>';
        rows.forEach(function(r) {
          html += '<tr><td>' + r.recruiter_name + '</td><td>' + r.division_name + '</td>' +
            '<td style="text-align:right">' + r.head_count + '</td>' +
            '<td style="text-align:right">' + fmtMoney(r.total_bill) + '</td>' +
            '<td style="text-align:right">' + fmtMoney(r.total_pay) + '</td>' +
            '<td style="text-align:right">' + fmtMoney(r.gross_profit_dollars) + '</td>' +
            '<td style="text-align:right">' + fmtPct(r.gross_margin_pct) + '</td></tr>';
        });
        html += '<tr style="font-weight:bold;background:#f0f0f0;"><td>TOTALS</td><td></td>' +
          '<td style="text-align:right">' + (totals.total_head_count || 0) + '</td>' +
          '<td style="text-align:right">' + fmtMoney(totals.total_bill) + '</td>' +
          '<td style="text-align:right">' + fmtMoney(totals.total_pay) + '</td>' +
          '<td style="text-align:right">' + fmtMoney(totals.total_gp_dollars) + '</td>' +
          '<td style="text-align:right">' + fmtPct(totals.overall_gm_pct) + '</td></tr>';
        html += '</tbody></table>';
        results.innerHTML = html;
      } catch (err) {
        results.innerHTML = '<p class="alert alert-error">Error: ' + err.message + '</p>';
      }
    }

    // =========== USER ADMIN ===========

    async function loadUsers() {
      try {
        var res = await fetch(API_BASE + '/user-configs?includeInactive=true');
        users = await res.json();
        renderUsers();
      } catch (err) {
        document.getElementById('users-table').innerHTML =
          '<tr><td colspan="10" class="alert alert-error">Error loading users: ' + err.message + '</td></tr>';
      }
    }

    function renderUsers() {
      var tbody = document.getElementById('users-table');
      if (!users.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="color:#6b7280;text-align:center;">No users yet. Users are auto-discovered when you run calculations.</td></tr>';
        return;
      }

      var html = '';
      users.forEach(function(u) {
        var roleBadge = u.role === 'recruiter'
          ? '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:4px;font-size:0.75rem;">Recruiter</span>'
          : u.role === 'account_manager'
          ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:0.75rem;">Acct Mgr</span>'
          : '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:0.75rem;">Unknown</span>';
        var statusBadge = u.is_active
          ? '<span class="badge badge-active">Active</span>'
          : '<span class="badge badge-inactive">Inactive</span>';
        var divName = divisions.find(function(d) { return d.division_id === u.division_id; });
        var checkmark = '<span style="color:#059669;">Y</span>';
        var dash = '<span style="color:#9ca3af;">-</span>';

        html += '<tr>' +
          '<td><strong>' + u.user_name + '</strong></td>' +
          '<td>' + u.user_id + '</td>' +
          '<td style="color:#6b7280;font-size:0.85rem;">' + (u.title || '-') + '</td>' +
          '<td>' + roleBadge + '</td>' +
          '<td>' + (divName ? divName.division_name : 'Div ' + u.division_id) + '</td>' +
          '<td>' + (u.weekly_goal || 0) + '</td>' +
          '<td style="text-align:center">' + (u.on_hours_report ? checkmark : dash) + '</td>' +
          '<td style="text-align:center">' + (u.on_stack_ranking ? checkmark : dash) + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td class="actions"><button class="btn btn-secondary" onclick="editUser(' + u.config_id + ')" style="padding:0.25rem 0.5rem;font-size:0.75rem;">Edit</button></td>' +
          '</tr>';
      });
      tbody.innerHTML = html;

      // Stats
      var active = users.filter(function(u) { return u.is_active; }).length;
      var onHours = users.filter(function(u) { return u.on_hours_report && u.is_active; }).length;
      var onSR = users.filter(function(u) { return u.on_stack_ranking && u.is_active; }).length;
      var totalGoal = users.filter(function(u) { return u.is_active && u.on_hours_report; }).reduce(function(sum, u) { return sum + (u.weekly_goal || 0); }, 0);
      document.getElementById('user-stats').innerHTML =
        '<div class="stat"><div class="stat-value">' + active + '</div><div class="stat-label">Active Users</div></div>' +
        '<div class="stat"><div class="stat-value">' + onHours + '</div><div class="stat-label">On Hours Report</div></div>' +
        '<div class="stat"><div class="stat-value">' + onSR + '</div><div class="stat-label">On Stack Ranking</div></div>' +
        '<div class="stat"><div class="stat-value">' + totalGoal.toLocaleString() + '</div><div class="stat-label">Total Weekly Goal</div></div>';
    }

    function openAddUserModal() {
      document.getElementById('modal-title').textContent = 'Add User';
      document.getElementById('user-form').reset();
      document.getElementById('edit-config-id').value = '';
      document.getElementById('edit-active').checked = true;
      document.getElementById('edit-hours-report').checked = false;
      document.getElementById('edit-stack-ranking').checked = false;
      document.getElementById('user-modal').classList.add('active');
    }

    function editUser(configId) {
      var u = users.find(function(usr) { return usr.config_id === configId; });
      if (!u) return;
      document.getElementById('modal-title').textContent = 'Edit User';
      document.getElementById('edit-config-id').value = u.config_id;
      document.getElementById('edit-name').value = u.user_name;
      document.getElementById('edit-user-id').value = u.user_id;
      document.getElementById('edit-title').value = u.title || '';
      document.getElementById('edit-role').value = u.role || 'unknown';
      document.getElementById('edit-division').value = u.division_id;
      document.getElementById('edit-goal').value = u.weekly_goal || 0;
      document.getElementById('edit-order').value = u.display_order || 99;
      document.getElementById('edit-hours-report').checked = !!u.on_hours_report;
      document.getElementById('edit-stack-ranking').checked = !!u.on_stack_ranking;
      document.getElementById('edit-active').checked = !!u.is_active;
      document.getElementById('user-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('user-modal').classList.remove('active');
    }

    document.getElementById('user-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var configId = document.getElementById('edit-config-id').value;
      var data = {
        user_name: document.getElementById('edit-name').value,
        user_id: parseInt(document.getElementById('edit-user-id').value),
        division_id: parseInt(document.getElementById('edit-division').value),
        role: document.getElementById('edit-role').value,
        title: document.getElementById('edit-title').value || null,
        weekly_goal: parseInt(document.getElementById('edit-goal').value) || 0,
        display_order: parseInt(document.getElementById('edit-order').value) || 99,
        on_hours_report: document.getElementById('edit-hours-report').checked,
        on_stack_ranking: document.getElementById('edit-stack-ranking').checked,
        is_active: document.getElementById('edit-active').checked
      };

      try {
        var res;
        if (configId) {
          res = await fetch(API_BASE + '/user-configs/' + configId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
        } else {
          res = await fetch(API_BASE + '/user-configs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
        }
        if (res.ok) {
          closeModal();
          showAlert(configId ? 'User updated' : 'User added');
          await loadUsers();
        } else {
          var err = await res.json();
          showAlert('Error: ' + (err.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showAlert('Error: ' + err.message, 'error');
      }
    });

    // Initialize
    async function init() {
      await loadDivisions();
      loadLastCalculation();
      document.getElementById('lastUpdated').textContent = 'Loaded: ' + new Date().toLocaleString();
    }

    init();
  </script>
</body>
</html>`;

    return {
      body: html,
      headers: { 'Content-Type': 'text/html' }
    };
  }
});

// CLEARCONNECT

app.http('getClearConnectUsers', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'clearconnect/users',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const users = await clearConnectService.getActiveUsers();
      return { jsonBody: users };
    } catch (error) {
      context.error('Error getting ClearConnect users:', error);
      return { status: 500, jsonBody: { error: 'Failed to get users from ClearConnect' } };
    }
  }
});

// DISCOVER RECRUITERS

app.http('discoverRecruiters', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'discover-recruiters',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      context.log('Discovering recruiters from ClearConnect...');

      // Get date range - just last 3 days for faster discovery
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 3);
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      context.log(`Fetching orders from ${startStr} to ${endStr}`);
      
      // Get orders
      const orders = await clearConnectService.getOrders(startStr, endStr);
      context.log(`Found ${orders.length} orders`);

      // Get all unique temp IDs
      const tempIds = [...new Set(orders.map(o => o.tempId).filter(id => id))];
      context.log(`Looking up ${tempIds.length} unique temps in batch...`);

      // Batch fetch all temps at once (much faster!)
      const tempsMap = await clearConnectService.getTempsBatch(tempIds);
      context.log(`Retrieved ${tempsMap.size} temps`);

      // Collect unique staffing specialists (recruiters)
      const recruiterIds = new Set<string>();
      for (const temp of tempsMap.values()) {
        if (temp.staffingSpecialist) {
          recruiterIds.add(temp.staffingSpecialist);
        }
      }
      context.log(`Found ${recruiterIds.size} unique recruiters`);

      // Batch fetch all users at once
      const usersMap = await clearConnectService.getUsersBatch([...recruiterIds]);
      context.log(`Retrieved ${usersMap.size} user records`);

      // Build discovered recruiters map
      const discoveredRecruiters = new Map<string, { userId: string; name: string; orderCount: number }>();
      
      for (const order of orders) {
        const temp = tempsMap.get(order.tempId);
        if (!temp || !temp.staffingSpecialist) continue;

        const recruiterId = temp.staffingSpecialist;
        
        if (!discoveredRecruiters.has(recruiterId)) {
          const user = usersMap.get(recruiterId);
          const name = user ? `${user.firstName} ${user.lastName}`.trim() : `User ${recruiterId}`;
          
          discoveredRecruiters.set(recruiterId, {
            userId: recruiterId,
            name: name,
            orderCount: 1
          });
        } else {
          const existing = discoveredRecruiters.get(recruiterId)!;
          existing.orderCount++;
        }
      }
      
      context.log(`Discovered ${discoveredRecruiters.size} unique recruiters`);
      
      // Get existing recruiters from database
      const existingRecruiters = await databaseService.getRecruiters(true);
      const existingUserIds = new Set(existingRecruiters.map(r => r.user_id));
      
      // Add new recruiters to database
      const added: any[] = [];
      const skipped: any[] = [];
      
      for (const [userId, info] of discoveredRecruiters) {
        const numericUserId = parseInt(userId, 10);
        
        if (existingUserIds.has(numericUserId)) {
          skipped.push({ userId: numericUserId, name: info.name, reason: 'Already exists', orderCount: info.orderCount });
          continue;
        }
        
        try {
          const newRecruiter = await databaseService.createRecruiter({
            user_id: numericUserId,
            user_name: info.name,
            division_id: 1,
            weekly_goal: 0,
            display_order: 99
          });
          added.push({ ...newRecruiter, orderCount: info.orderCount });
          context.log(`Added recruiter: ${info.name}`);
        } catch (err) {
          context.log(`Error adding recruiter ${info.name}: ${err}`);
          skipped.push({ userId: numericUserId, name: info.name, reason: String(err) });
        }
      }
      
      return { 
        jsonBody: { 
          dateRange: { start: startStr, end: endStr },
          ordersProcessed: orders.length,
          tempsFound: tempsMap.size,
          discovered: discoveredRecruiters.size,
          added: added.length,
          skipped: skipped.length,
          addedRecruiters: added,
          skippedRecruiters: skipped
        } 
      };
    } catch (error) {
      context.error('Error discovering recruiters:', error);
      return { status: 500, jsonBody: { error: 'Failed to discover recruiters', details: String(error) } };
    }
  }
});

// DEBUG - Test ClearConnect API

app.http('debugClearConnect', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'debug/clearconnect',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      context.log('Testing ClearConnect connection...');
      
      const result = await clearConnectService.testConnection();
      
      return { jsonBody: result };
    } catch (error) {
      context.error('Debug error:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// USER CONFIG (Stack Ranking users)

app.http('getUserConfigs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'user-configs',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const includeInactive = request.query.get('includeInactive') === 'true';
      const users = await databaseService.getUserConfigs(includeInactive);
      return { jsonBody: users };
    } catch (error) {
      context.error('Error getting user configs:', error);
      return { status: 500, jsonBody: { error: 'Failed to get user configs' } };
    }
  }
});

app.http('createUserConfig', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'user-configs',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const user = await databaseService.createUserConfig(body);
      return { status: 201, jsonBody: user };
    } catch (error) {
      context.error('Error creating user config:', error);
      return { status: 500, jsonBody: { error: 'Failed to create user config' } };
    }
  }
});

app.http('updateUserConfig', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'user-configs/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = parseInt(request.params.id || '0');
      const body = await request.json() as any;
      const user = await databaseService.updateUserConfig({ ...body, config_id: id });
      if (!user) {
        return { status: 404, jsonBody: { error: 'User config not found' } };
      }
      return { jsonBody: user };
    } catch (error) {
      context.error('Error updating user config:', error);
      return { status: 500, jsonBody: { error: 'Failed to update user config' } };
    }
  }
});

// STACK RANKING

app.http('getStackRanking', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'stack-ranking',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const weekStartParam = request.query.get('weekStart');
      const weekEndParam = request.query.get('weekEnd');

      let weekStart: string;
      let weekEnd: string;

      if (weekStartParam && weekEndParam) {
        weekStart = weekStartParam;
        weekEnd = weekEndParam;
      } else {
        const boundaries = stackRankingService.getLastWeekBoundaries();
        weekStart = boundaries.weekStart;
        weekEnd = boundaries.weekEnd;
      }

      const { rows, totals } = await stackRankingService.calculateRanking(weekStart, weekEnd);
      return { jsonBody: { weekStart, weekEnd, rows, totals } };
    } catch (error) {
      context.error('Error getting stack ranking:', error);
      return { status: 500, jsonBody: { error: 'Failed to get stack ranking' } };
    }
  }
});

app.http('getStackRankingHtml', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'stack-ranking/html',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const weekStartParam = request.query.get('weekStart');
      const weekEndParam = request.query.get('weekEnd');

      let weekStart: string;
      let weekEnd: string;

      if (weekStartParam && weekEndParam) {
        weekStart = weekStartParam;
        weekEnd = weekEndParam;
      } else {
        const boundaries = stackRankingService.getLastWeekBoundaries();
        weekStart = boundaries.weekStart;
        weekEnd = boundaries.weekEnd;
      }

      const { rows, totals } = await stackRankingService.calculateRanking(weekStart, weekEnd);
      const html = emailService.generateStackRankingHtml(rows, totals, weekStart, weekEnd);

      return {
        headers: { 'Content-Type': 'text/html' },
        body: html,
      };
    } catch (error) {
      context.error('Error getting stack ranking HTML:', error);
      return { status: 500, jsonBody: { error: 'Failed to generate stack ranking HTML' } };
    }
  }
});

app.http('sendStackRankingEmail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'stack-ranking/send-email',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const weekStartParam = body?.weekStart;
      const weekEndParam = body?.weekEnd;
      const testRecipient = body?.recipient;

      let weekStart: string;
      let weekEnd: string;

      if (weekStartParam && weekEndParam) {
        weekStart = weekStartParam;
        weekEnd = weekEndParam;
      } else {
        const boundaries = stackRankingService.getLastWeekBoundaries();
        weekStart = boundaries.weekStart;
        weekEnd = boundaries.weekEnd;
      }

      const { rows, totals } = await stackRankingService.calculateRanking(weekStart, weekEnd);
      const html = emailService.generateStackRankingHtml(rows, totals, weekStart, weekEnd);

      let recipients: string[];
      if (testRecipient) {
        recipients = [testRecipient];
      } else {
        recipients = (process.env.STACK_RANKING_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
      }

      if (recipients.length === 0) {
        return { status: 400, jsonBody: { error: 'No recipients configured. Set STACK_RANKING_RECIPIENTS or provide a recipient in the request body.' } };
      }

      await emailService.sendEmail(recipients, `GHR Stack Ranking - Week of ${weekStart}`, html);

      return {
        jsonBody: {
          success: true,
          weekStart,
          weekEnd,
          recipientCount: recipients.length,
          recruiterCount: rows.length,
        },
      };
    } catch (error) {
      context.error('Error sending stack ranking email:', error);
      return { status: 500, jsonBody: { error: 'Failed to send stack ranking email' } };
    }
  }
});

// FINANCIALS

app.http('getFinancials', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'financials',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const weekStartParam = request.query.get('weekStart');
      const weekEndParam = request.query.get('weekEnd');

      let weekStart: string;
      let weekEnd: string;

      if (weekStartParam && weekEndParam) {
        weekStart = weekStartParam;
        weekEnd = weekEndParam;
      } else {
        // Default to ~2 weeks back
        const boundaries = stackRankingService.getLastWeekBoundaries();
        const d = new Date(boundaries.weekStart + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 7);
        weekStart = d.toISOString().split('T')[0];
        const dEnd = new Date(weekStart + 'T00:00:00Z');
        dEnd.setUTCDate(dEnd.getUTCDate() + 6);
        weekEnd = dEnd.toISOString().split('T')[0];
      }

      const { rows, totals } = await stackRankingService.getFinancialData(weekStart, weekEnd);
      return { jsonBody: { weekStart, weekEnd, rows, totals } };
    } catch (error) {
      context.error('Error getting financial data:', error);
      return { status: 500, jsonBody: { error: 'Failed to get financial data' } };
    }
  }
});

// HEALTH CHECK

app.http('healthCheck', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    return {
      jsonBody: {
        status: 'healthy',
        timestamp: new Date().toISOString()
      }
    };
  }
});
