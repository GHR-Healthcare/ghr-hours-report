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

      // Get date range (last 2 weeks to capture active recruiters)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 14);
      
      const startStr = startDate.toISOString().split('T')[0];
      const endStr = endDate.toISOString().split('T')[0];
      
      context.log(`Fetching orders from ${startStr} to ${endStr}`);
      
      // Get orders (no region filter)
      const orders = await clearConnectService.getOrders(startStr, endStr);
      context.log(`Found ${orders.length} orders`);
      
      // Track discovered recruiters
      const discoveredRecruiters = new Map<string, { userId: string; name: string; orderCount: number }>();
      
      // Process each order to find staffing specialists
      for (const order of orders) {
        if (!order.tempId) continue;
        
        try {
          const temp = await clearConnectService.getTemp(order.tempId);
          if (!temp || !temp.staffingSpecialist) continue;
          
          const recruiterId = temp.staffingSpecialist;
          
          if (!discoveredRecruiters.has(recruiterId)) {
            const user = await clearConnectService.getUser(recruiterId);
            const name = user ? `${user.firstName} ${user.lastName}`.trim() : `User ${recruiterId}`;
            
            discoveredRecruiters.set(recruiterId, {
              userId: recruiterId,
              name: name,
              orderCount: 1
            });
            context.log(`Discovered recruiter: ${name} (ID: ${recruiterId})`);
          } else {
            const existing = discoveredRecruiters.get(recruiterId)!;
            existing.orderCount++;
          }
        } catch (err) {
          context.log(`Error processing order ${order.orderId}: ${err}`);
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
          skipped.push({ userId: numericUserId, name: info.name, reason: 'Already exists' });
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
          added.push(newRecruiter);
          context.log(`Added recruiter: ${info.name}`);
        } catch (err) {
          context.log(`Error adding recruiter ${info.name}: ${err}`);
          skipped.push({ userId: numericUserId, name: info.name, reason: String(err) });
        }
      }
      
      return { 
        jsonBody: { 
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
