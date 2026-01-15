import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { clearConnectService } from '../services/clearconnect';
import { calculateAllHours } from '../utils/hours-calculator';

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
// It calculates total hours for the entire week (Sun-Sat) for this week and next week
// Only updates the current day's snapshot slot, preserving previous days
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
      
      // Last week: previous Sunday to Saturday (only update if we're on Sun/Mon)
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
      
      // Get configured recruiters
      const configuredRecruiters = await databaseService.getRecruiters(true);
      const configuredUserIds = new Set(configuredRecruiters.map(r => r.user_id));
      context.log(`Found ${configuredUserIds.size} configured recruiters`);
      
      const results: any = {
        lastWeek: { weekStart: formatDate(lastWeekSunday), hours: {} as Record<number, number>, totalOrders: 0, filteredOrders: 0, updated: false },
        thisWeek: { weekStart: formatDate(thisWeekSunday), hours: {} as Record<number, number>, totalOrders: 0, filteredOrders: 0, updated: true },
        nextWeek: { weekStart: formatDate(nextWeekSunday), hours: {} as Record<number, number>, totalOrders: 0, filteredOrders: 0, updated: true }
      };
      const newRecruiters: any[] = [];
      
      // Process this week and next week (always update current day slot)
      // Only process last week on Sun/Mon (day 0) to capture final totals
      const weeksToProcess: Array<[string, Date, Date, boolean]> = [
        ['thisWeek', thisWeekSunday, thisWeekSaturday, true],
        ['nextWeek', nextWeekSunday, nextWeekSaturday, true]
      ];
      
      // On Sunday/Monday, also update last week's final snapshot
      if (snapshotDayOfWeek === 0) {
        weeksToProcess.unshift(['lastWeek', lastWeekSunday, lastWeekSaturday, true]);
        results.lastWeek.updated = true;
      }
      
      for (const [weekName, weekSunday, weekSaturday, shouldUpdate] of weeksToProcess) {
        if (!shouldUpdate) continue;
        
        const weekStart = formatDate(weekSunday as Date);
        const weekEnd = formatDate(weekSaturday as Date);
        
        context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}`);
        
        // Get all orders for the week
        const allOrders = await clearConnectService.getOrders(weekStart, weekEnd);
        results[weekName].totalOrders = allOrders.length;
        
        // Filter orders by region
        const orders = allOrders.filter(order => {
          const regionName = (order.regionName || '').toLowerCase();
          return regionName.includes('nursing') || regionName.includes('acute') || regionName.includes('temp to perm');
        });
        results[weekName].filteredOrders = orders.length;
        
        context.log(`${weekName}: ${orders.length} filtered orders from ${allOrders.length} total`);
        
        // Get unique temps
        const tempIds = [...new Set(orders.map(o => o.tempId).filter(id => id))];
        const tempsMap = await clearConnectService.getTempsBatch(tempIds);
        
        // Calculate hours by recruiter
        const hoursByRecruiter: Record<number, number> = {};
        
        for (const order of orders) {
          const temp = tempsMap.get(order.tempId);
          if (!temp || !temp.staffingSpecialist) continue;
          
          const recruiterId = parseInt(temp.staffingSpecialist, 10);
          
          // Auto-add recruiter if not in database
          if (!configuredUserIds.has(recruiterId)) {
            try {
              const user = await clearConnectService.getUser(temp.staffingSpecialist);
              const userName = user ? `${user.firstName} ${user.lastName}`.trim() : `User ${recruiterId}`;
              
              await databaseService.createRecruiter({
                user_id: recruiterId,
                user_name: userName,
                division_id: 1,
                weekly_goal: 0,
                display_order: 99
              });
              
              configuredUserIds.add(recruiterId);
              newRecruiters.push({ userId: recruiterId, name: userName });
              context.log(`Auto-added recruiter: ${userName} (ID: ${recruiterId})`);
            } catch (addError) {
              context.log(`Error adding recruiter ${recruiterId}: ${addError}`);
              continue;
            }
          }
          
          const startTime = new Date(order.shiftStartTime);
          const endTime = new Date(order.shiftEndTime);
          const lunchMinutes = parseInt(order.lessLunchMin, 10) || 0;
          
          const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
          const workedMinutes = totalMinutes - lunchMinutes;
          const hours = workedMinutes / 60;
          
          if (!hoursByRecruiter[recruiterId]) {
            hoursByRecruiter[recruiterId] = 0;
          }
          hoursByRecruiter[recruiterId] += hours;
        }
        
        // Round and save snapshots - ONLY for current day slot
        for (const [userIdStr, hours] of Object.entries(hoursByRecruiter)) {
          const roundedHours = Math.round(hours * 100) / 100;
          hoursByRecruiter[parseInt(userIdStr)] = roundedHours;
          await databaseService.upsertWeeklySnapshot(
            parseInt(userIdStr), 
            weekStart, 
            snapshotDayOfWeek, 
            roundedHours
          );
        }
        
        results[weekName].hours = hoursByRecruiter;
      }
      
      return { 
        jsonBody: { 
          calculatedAt: now.toISOString(),
          snapshotDayOfWeek,
          snapshotDayName: ['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][snapshotDayOfWeek],
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
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'send-email',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const includeLastWeek = body.includeLastWeek === true;
      
      const reportData = await databaseService.getReportData();
      const weeklyTotals = await databaseService.getWeeklyTotals();
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek);
      
      const recipients = (process.env.EMAIL_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
      const subject = includeLastWeek ? 'Daily Hours - Last Week' : 'Daily Hours';
      
      await emailService.sendEmail(recipients, subject, html);
      
      return { jsonBody: { success: true, recipients: recipients.length } };
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
      const { recipient, includeLastWeek } = body;
      
      if (!recipient) {
        return { status: 400, jsonBody: { error: 'recipient is required' } };
      }
      
      const reportData = await databaseService.getReportData();
      const weeklyTotals = await databaseService.getWeeklyTotals();
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek === true);
      
      const subject = includeLastWeek ? '[TEST] Daily Hours - Last Week' : '[TEST] Daily Hours';
      
      await emailService.sendEmail([recipient], subject, html);
      
      return { jsonBody: { success: true, recipient, includeLastWeek: includeLastWeek === true } };
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
  </style>
</head>
<body>
  <div class="header">
    <h1>GHR Hours Report Admin</h1>
    <span id="lastUpdated"></span>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" data-tab="recruiters">Recruiters</button>
      <button class="tab" data-tab="email">Test Email</button>
      <button class="tab" data-tab="preview">Preview Report</button>
      <button class="tab" data-tab="calculate">Recalculate</button>
    </div>

    <div id="alert"></div>

    <!-- Recruiters Panel -->
    <div class="panel active" id="recruiters-panel">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h2>Manage Recruiters</h2>
        <button class="btn btn-primary" onclick="openAddRecruiterModal()">+ Add Recruiter</button>
      </div>
      
      <div class="stats" id="recruiter-stats"></div>
      
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>User ID</th>
            <th>Division</th>
            <th>Weekly Goal</th>
            <th>Display Order</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="recruiters-table"></tbody>
      </table>
    </div>

    <!-- Email Panel -->
    <div class="panel" id="email-panel">
      <h2>Send Test Email</h2>
      <p style="color: #6b7280; margin-bottom: 1.5rem;">Send a test email to yourself before sending to the whole team.</p>
      
      <div class="form-group">
        <label>Recipient Email</label>
        <input type="email" id="test-email-recipient" placeholder="your.email@ghrhealthcare.com">
      </div>
      
      <div class="email-options">
        <div class="email-option selected" data-type="daily" onclick="selectEmailType('daily')">
          <h4>📊 Daily Report</h4>
          <p>Standard daily email sent at 8am, 12pm, 5pm</p>
        </div>
        <div class="email-option" data-type="monday" onclick="selectEmailType('monday')">
          <h4>📅 Monday Report</h4>
          <p>Includes last week summary (sent Monday mornings)</p>
        </div>
      </div>
      
      <button class="btn btn-primary" onclick="sendTestEmail()" id="send-test-btn">Send Test Email</button>
    </div>

    <!-- Preview Panel -->
    <div class="panel" id="preview-panel">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h2>Report Preview</h2>
        <div>
          <button class="btn btn-secondary" onclick="loadPreview(false)">Daily View</button>
          <button class="btn btn-secondary" onclick="loadPreview(true)">Monday View</button>
        </div>
      </div>
      <iframe id="preview-frame" class="preview-frame"></iframe>
    </div>

    <!-- Calculate Panel -->
    <div class="panel" id="calculate-panel">
      <h2>Recalculate Weekly Hours</h2>
      <p style="color: #6b7280; margin-bottom: 1.5rem;">Re-fetch hours from ClearConnect for last week, this week, and next week. Use this if data looks incorrect or to refresh before sending a test email.</p>
      
      <button class="btn btn-primary" onclick="runCalculation()" id="calc-btn">Run Weekly Calculation</button>
      
      <div id="calc-results" style="margin-top: 1.5rem;"></div>
    </div>
  </div>

  <!-- Add/Edit Recruiter Modal -->
  <div class="modal" id="recruiter-modal">
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="modal-title">Add Recruiter</h2>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <form id="recruiter-form">
        <input type="hidden" id="edit-config-id">
        <div class="form-group">
          <label>Name</label>
          <input type="text" id="edit-name" required>
        </div>
        <div class="form-group">
          <label>User ID (from ClearConnect)</label>
          <input type="number" id="edit-user-id" required>
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
        <div class="form-group">
          <label>
            <input type="checkbox" id="edit-active" checked> Active
          </label>
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
    let recruiters = [];
    let selectedEmailType = 'daily';

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-panel').classList.add('active');
        
        if (tab.dataset.tab === 'preview') {
          loadPreview(false);
        }
      });
    });

    // Alert display
    function showAlert(message, type = 'success') {
      const alert = document.getElementById('alert');
      alert.innerHTML = '<div class="alert alert-' + type + '">' + message + '</div>';
      setTimeout(() => alert.innerHTML = '', 5000);
    }

    // Load divisions
    async function loadDivisions() {
      const res = await fetch(API_BASE + '/divisions');
      divisions = await res.json();
      
      const select = document.getElementById('edit-division');
      select.innerHTML = divisions.map(d => 
        '<option value="' + d.division_id + '">' + d.division_name + '</option>'
      ).join('');
    }

    // Load recruiters
    async function loadRecruiters() {
      const res = await fetch(API_BASE + '/recruiters?includeInactive=true');
      recruiters = await res.json();
      
      const tbody = document.getElementById('recruiters-table');
      tbody.innerHTML = recruiters.map(r => {
        const div = divisions.find(d => d.division_id === r.division_id);
        return '<tr>' +
          '<td><strong>' + r.user_name + '</strong></td>' +
          '<td>' + r.user_id + '</td>' +
          '<td>' + (div ? div.division_name : 'Unknown') + '</td>' +
          '<td>' + r.weekly_goal + '</td>' +
          '<td>' + r.display_order + '</td>' +
          '<td><span class="badge ' + (r.is_active ? 'badge-active' : 'badge-inactive') + '">' + 
            (r.is_active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td class="actions">' +
            '<button class="btn btn-secondary" onclick="editRecruiter(' + r.config_id + ')">Edit</button>' +
            '<button class="btn btn-danger" onclick="deleteRecruiter(' + r.config_id + ', \\'' + r.user_name.replace(/'/g, "\\\\'") + '\\')">Delete</button>' +
          '</td>' +
        '</tr>';
      }).join('');
      
      // Update stats
      const active = recruiters.filter(r => r.is_active).length;
      const totalGoal = recruiters.filter(r => r.is_active).reduce((sum, r) => sum + r.weekly_goal, 0);
      document.getElementById('recruiter-stats').innerHTML = 
        '<div class="stat"><div class="stat-value">' + active + '</div><div class="stat-label">Active Recruiters</div></div>' +
        '<div class="stat"><div class="stat-value">' + (recruiters.length - active) + '</div><div class="stat-label">Inactive</div></div>' +
        '<div class="stat"><div class="stat-value">' + totalGoal.toLocaleString() + '</div><div class="stat-label">Total Weekly Goal</div></div>';
    }

    // Modal functions
    function openAddRecruiterModal() {
      document.getElementById('modal-title').textContent = 'Add Recruiter';
      document.getElementById('recruiter-form').reset();
      document.getElementById('edit-config-id').value = '';
      document.getElementById('edit-active').checked = true;
      document.getElementById('recruiter-modal').classList.add('active');
    }

    function editRecruiter(configId) {
      const r = recruiters.find(rec => rec.config_id === configId);
      if (!r) return;
      
      document.getElementById('modal-title').textContent = 'Edit Recruiter';
      document.getElementById('edit-config-id').value = r.config_id;
      document.getElementById('edit-name').value = r.user_name;
      document.getElementById('edit-user-id').value = r.user_id;
      document.getElementById('edit-division').value = r.division_id;
      document.getElementById('edit-goal').value = r.weekly_goal;
      document.getElementById('edit-order').value = r.display_order;
      document.getElementById('edit-active').checked = r.is_active;
      document.getElementById('recruiter-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('recruiter-modal').classList.remove('active');
    }

    // Save recruiter
    document.getElementById('recruiter-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const configId = document.getElementById('edit-config-id').value;
      const data = {
        user_name: document.getElementById('edit-name').value,
        user_id: parseInt(document.getElementById('edit-user-id').value),
        division_id: parseInt(document.getElementById('edit-division').value),
        weekly_goal: parseInt(document.getElementById('edit-goal').value) || 0,
        display_order: parseInt(document.getElementById('edit-order').value) || 99,
        is_active: document.getElementById('edit-active').checked
      };
      
      try {
        if (configId) {
          await fetch(API_BASE + '/recruiters/' + configId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          showAlert('Recruiter updated successfully');
        } else {
          await fetch(API_BASE + '/recruiters', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          showAlert('Recruiter added successfully');
        }
        closeModal();
        loadRecruiters();
      } catch (err) {
        showAlert('Error saving recruiter: ' + err.message, 'error');
      }
    });

    // Delete recruiter
    async function deleteRecruiter(configId, name) {
      if (!confirm('Are you sure you want to delete ' + name + '?')) return;
      
      try {
        await fetch(API_BASE + '/recruiters/' + configId, { method: 'DELETE' });
        showAlert('Recruiter deleted');
        loadRecruiters();
      } catch (err) {
        showAlert('Error deleting recruiter: ' + err.message, 'error');
      }
    }

    // Email functions
    function selectEmailType(type) {
      selectedEmailType = type;
      document.querySelectorAll('.email-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.type === type);
      });
    }

    async function sendTestEmail() {
      const recipient = document.getElementById('test-email-recipient').value;
      if (!recipient) {
        showAlert('Please enter a recipient email', 'error');
        return;
      }
      
      const btn = document.getElementById('send-test-btn');
      btn.textContent = 'Sending...';
      btn.disabled = true;
      
      try {
        const res = await fetch(API_BASE + '/send-test-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: recipient,
            includeLastWeek: selectedEmailType === 'monday'
          })
        });
        
        const data = await res.json();
        if (res.ok) {
          showAlert('Test email sent to ' + recipient);
        } else {
          showAlert('Error: ' + (data.error || 'Unknown error'), 'error');
        }
      } catch (err) {
        showAlert('Error sending email: ' + err.message, 'error');
      } finally {
        btn.textContent = 'Send Test Email';
        btn.disabled = false;
      }
    }

    // Preview
    function loadPreview(includeLastWeek) {
      const frame = document.getElementById('preview-frame');
      frame.src = API_BASE + '/report/html?includeLastWeek=' + includeLastWeek;
    }

    // Calculation
    async function runCalculation() {
      const btn = document.getElementById('calc-btn');
      const results = document.getElementById('calc-results');
      btn.textContent = 'Running...';
      btn.disabled = true;
      results.innerHTML = '<p>Calculating weekly hours... this may take a minute.</p>';
      
      try {
        const res = await fetch(API_BASE + '/calculate/weekly');
        const data = await res.json();
        
        if (res.ok) {
          let html = '<h3>Results</h3>';
          html += '<p>Calculated at: ' + new Date(data.calculatedAt).toLocaleString() + '</p>';
          html += '<p>Snapshot day of week: ' + ['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][data.snapshotDayOfWeek] + '</p>';
          
          if (data.newRecruitersAdded && data.newRecruitersAdded.length > 0) {
            html += '<p><strong>New recruiters added:</strong> ' + 
              data.newRecruitersAdded.map(r => r.name).join(', ') + '</p>';
          }
          
          html += '<table><thead><tr><th>Week</th><th>Total Orders</th><th>Filtered</th><th>Recruiters</th></tr></thead><tbody>';
          for (const [weekName, weekData] of Object.entries(data.results)) {
            const week = weekData;
            html += '<tr><td>' + weekName + ' (' + week.weekStart + ')</td><td>' + week.totalOrders + '</td><td>' + 
              week.filteredOrders + '</td><td>' + Object.keys(week.hours).length + '</td></tr>';
          }
          html += '</tbody></table>';
          
          results.innerHTML = html;
          showAlert('Calculation complete!');
          loadRecruiters();
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

    // Initialize
    async function init() {
      await loadDivisions();
      await loadRecruiters();
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
