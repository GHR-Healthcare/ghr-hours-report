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

// Calculate for a single day (much faster for testing)
app.http('calculateDay', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'calculate/day',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      // Get date from query param or use today
      const dateParam = request.query.get('date');
      const targetDate = dateParam ? new Date(dateParam) : new Date();
      const dateStr = targetDate.toISOString().split('T')[0];
      
      context.log(`Calculating hours for ${dateStr}...`);
      
      const nextDate = new Date(targetDate);
      nextDate.setDate(nextDate.getDate() + 1);
      const nextDateStr = nextDate.toISOString().split('T')[0];
      
      // Get orders for this day
      const orders = await clearConnectService.getOrders(dateStr, dateStr);
      context.log(`Found ${orders.length} orders for ${dateStr}`);
      
      // Get unique temps
      const tempIds = [...new Set(orders.map(o => o.tempId).filter(id => id))];
      const tempsMap = await clearConnectService.getTempsBatch(tempIds);
      
      // Calculate hours by recruiter
      const hoursByRecruiter: Record<number, number> = {};
      
      for (const order of orders) {
        const temp = tempsMap.get(order.tempId);
        if (!temp || !temp.staffingSpecialist) continue;
        
        const recruiterId = parseInt(temp.staffingSpecialist, 10);
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
      
      // Save snapshots
      let saved = 0;
      for (const [userIdStr, hours] of Object.entries(hoursByRecruiter)) {
        const roundedHours = Math.round(hours * 100) / 100;
        await databaseService.upsertDailySnapshot(parseInt(userIdStr), dateStr, roundedHours);
        saved++;
      }
      
      return { 
        jsonBody: { 
          date: dateStr,
          ordersProcessed: orders.length,
          tempsFound: tempsMap.size,
          recruitersWithHours: Object.keys(hoursByRecruiter).length,
          snapshotsSaved: saved,
          hoursSummary: hoursByRecruiter
        } 
      };
    } catch (error) {
      context.error('Error calculating day:', error);
      return { status: 500, jsonBody: { error: 'Failed to calculate', details: String(error) } };
    }
  }
});

// Calculate for a date range (with progress)
app.http('calculateRange', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'calculate/range',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const startParam = request.query.get('start');
      const endParam = request.query.get('end');
      
      if (!startParam || !endParam) {
        return { 
          status: 400, 
          jsonBody: { error: 'Missing start or end date. Use ?start=2026-01-12&end=2026-01-14' } 
        };
      }
      
      const startDate = new Date(startParam);
      const endDate = new Date(endParam);
      
      const results: any[] = [];
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        context.log(`Processing ${dateStr}...`);
        
        try {
          const orders = await clearConnectService.getOrders(dateStr, dateStr);
          const tempIds = [...new Set(orders.map(o => o.tempId).filter(id => id))];
          const tempsMap = await clearConnectService.getTempsBatch(tempIds);
          
          const hoursByRecruiter: Record<number, number> = {};
          
          for (const order of orders) {
            const temp = tempsMap.get(order.tempId);
            if (!temp || !temp.staffingSpecialist) continue;
            
            const recruiterId = parseInt(temp.staffingSpecialist, 10);
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
          
          // Save snapshots
          for (const [userIdStr, hours] of Object.entries(hoursByRecruiter)) {
            const roundedHours = Math.round(hours * 100) / 100;
            await databaseService.upsertDailySnapshot(parseInt(userIdStr), dateStr, roundedHours);
          }
          
          results.push({
            date: dateStr,
            orders: orders.length,
            recruiters: Object.keys(hoursByRecruiter).length,
            status: 'success'
          });
        } catch (err) {
          results.push({
            date: dateStr,
            status: 'error',
            error: String(err)
          });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      return { 
        jsonBody: { 
          range: { start: startParam, end: endParam },
          daysProcessed: results.length,
          results
        } 
      };
    } catch (error) {
      context.error('Error calculating range:', error);
      return { status: 500, jsonBody: { error: 'Failed to calculate range', details: String(error) } };
    }
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
