import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { clearConnectService } from '../services/clearconnect';
import { calculateAllHours } from '../utils/hours-calculator';

// ============================================
// DIVISIONS API
// ============================================

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
      return { status: 500, jsonBody: { error: String(error) } };
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
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

app.http('updateDivision', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'divisions/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const divisionId = parseInt(request.params.id || '0');
      const body = await request.json() as any;
      const division = await databaseService.updateDivision({ ...body, division_id: divisionId });
      
      if (!division) {
        return { status: 404, jsonBody: { error: 'Division not found' } };
      }
      
      return { jsonBody: division };
    } catch (error) {
      context.error('Error updating division:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// RECRUITERS API
// ============================================

app.http('getRecruiters', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recruiters',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const includeInactive = request.query.get('includeInactive') === 'true';
      const divisionId = request.query.get('divisionId');
      
      let recruiters;
      if (divisionId) {
        recruiters = await databaseService.getRecruitersByDivision(parseInt(divisionId));
      } else {
        recruiters = await databaseService.getRecruiters(includeInactive);
      }
      
      return { jsonBody: recruiters };
    } catch (error) {
      context.error('Error getting recruiters:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

app.http('getRecruiterById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const configId = parseInt(request.params.id || '0');
      const recruiter = await databaseService.getRecruiterById(configId);
      
      if (!recruiter) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      
      return { jsonBody: recruiter };
    } catch (error) {
      context.error('Error getting recruiter:', error);
      return { status: 500, jsonBody: { error: String(error) } };
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
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

app.http('updateRecruiter', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const configId = parseInt(request.params.id || '0');
      const body = await request.json() as any;
      const recruiter = await databaseService.updateRecruiter({ ...body, config_id: configId });
      
      if (!recruiter) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      
      return { jsonBody: recruiter };
    } catch (error) {
      context.error('Error updating recruiter:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

app.http('deleteRecruiter', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const configId = parseInt(request.params.id || '0');
      const deleted = await databaseService.deleteRecruiter(configId);
      
      if (!deleted) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      
      return { status: 204 };
    } catch (error) {
      context.error('Error deleting recruiter:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// REPORT API
// ============================================

app.http('getReport', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'report',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const weekPeriod = request.query.get('weekPeriod') as 'Last Week' | 'This Week' | 'Next Week' | null;
      const reportData = await databaseService.getReportData(weekPeriod || undefined);
      const weeklyTotals = await databaseService.getWeeklyTotals();
      
      return { 
        jsonBody: { 
          data: reportData, 
          totals: weeklyTotals 
        } 
      };
    } catch (error) {
      context.error('Error getting report:', error);
      return { status: 500, jsonBody: { error: String(error) } };
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
        headers: { 'Content-Type': 'text/html' },
        body: html 
      };
    } catch (error) {
      context.error('Error generating report HTML:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// MANUAL ACTIONS API
// ============================================

app.http('triggerCalculation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'actions/calculate',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      context.log('Manual calculation triggered');
      const result = await calculateAllHours();
      return { jsonBody: result };
    } catch (error) {
      context.error('Error in manual calculation:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

app.http('triggerEmail', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'actions/send-email',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const body = await request.json() as any;
      const includeLastWeek = body.includeLastWeek || false;
      const testEmail = body.testEmail; // Optional: send to specific email for testing
      
      // First calculate hours
      await calculateAllHours();
      
      // Get report data
      const reportData = await databaseService.getReportData();
      const weeklyTotals = await databaseService.getWeeklyTotals();
      
      // Generate email
      const subject = includeLastWeek ? 'Daily Hours - Last Week' : 'Daily Hours';
      const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek);
      
      // Send email
      const recipients = testEmail ? [testEmail] : (process.env.EMAIL_RECIPIENTS || '').split(',').filter(e => e.trim());
      
      if (recipients.length === 0) {
        return { status: 400, jsonBody: { error: 'No email recipients configured' } };
      }
      
      await emailService.sendEmail(recipients, subject, html);
      
      return { jsonBody: { success: true, recipients } };
    } catch (error) {
      context.error('Error sending email:', error);
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// CLEARCONNECT USERS API (for admin UI lookup)
// ============================================

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
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// REGIONS API
// ============================================

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
      return { status: 500, jsonBody: { error: String(error) } };
    }
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    return { jsonBody: { status: 'healthy', timestamp: new Date().toISOString() } };
  }
});
