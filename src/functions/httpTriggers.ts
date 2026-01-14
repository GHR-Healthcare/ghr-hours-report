import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { clearConnectService } from '../services/clearconnect';
import { databaseService } from '../services/database';

// Discover recruiters from ClearConnect
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
      
      // Get orders (no region filter - just date and status)
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
            // Look up user name
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
          // Add with default division (1 = PA Nursing) and goal (0)
          // These can be updated later via the API
          const newRecruiter = await databaseService.createRecruiter({
            user_id: numericUserId,
            user_name: info.name,
            division_id: 1, // Default to PA Nursing
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

// Get all recruiters
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
      context.error('Error fetching recruiters:', error);
      return { status: 500, jsonBody: { error: 'Failed to fetch recruiters' } };
    }
  }
});

// Get all divisions
app.http('getDivisions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'divisions',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const divisions = await databaseService.getDivisions();
      return { jsonBody: divisions };
    } catch (error) {
      context.error('Error fetching divisions:', error);
      return { status: 500, jsonBody: { error: 'Failed to fetch divisions' } };
    }
  }
});

// Update recruiter
app.http('updateRecruiter', {
  methods: ['PUT', 'PATCH'],
  authLevel: 'anonymous',
  route: 'recruiters/{id}',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      const id = parseInt(request.params.id, 10);
      const body = await request.json() as any;
      
      const updated = await databaseService.updateRecruiter(id, body);
      if (!updated) {
        return { status: 404, jsonBody: { error: 'Recruiter not found' } };
      }
      
      return { jsonBody: updated };
    } catch (error) {
      context.error('Error updating recruiter:', error);
      return { status: 500, jsonBody: { error: 'Failed to update recruiter' } };
    }
  }
});

// Generate hours report
app.http('generateReport', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: 'generate-report',
  handler: async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    try {
      context.log('Generating hours report...');
      
      // Calculate date ranges for last week, this week, next week
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 = Sunday
      
      // Get start of this week (Sunday)
      const thisWeekStart = new Date(today);
      thisWeekStart.setDate(today.getDate() - dayOfWeek);
      thisWeekStart.setHours(0, 0, 0, 0);
      
      // Last week
      const lastWeekStart = new Date(thisWeekStart);
      lastWeekStart.setDate(lastWeekStart.getDate() - 7);
      
      // Next week
      const nextWeekStart = new Date(thisWeekStart);
      nextWeekStart.setDate(nextWeekStart.getDate() + 7);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);

      // Format dates
      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      
      context.log(`Report period: ${formatDate(lastWeekStart)} to ${formatDate(nextWeekEnd)}`);

      // Get recruiters and divisions
      const recruiters = await databaseService.getRecruiters(false);
      const divisions = await databaseService.getDivisions();
      
      context.log(`Found ${recruiters.length} active recruiters in ${divisions.length} divisions`);

      // Calculate hours for each day
      const allDays: string[] = [];
      for (let d = new Date(lastWeekStart); d <= nextWeekEnd; d.setDate(d.getDate() + 1)) {
        allDays.push(formatDate(new Date(d)));
      }

      const hoursByDay: Record<string, Record<number, number>> = {};
      
      for (const day of allDays) {
        const nextDay = new Date(day);
        nextDay.setDate(nextDay.getDate() + 1);
        const nextDayStr = formatDate(nextDay);
        
        hoursByDay[day] = await clearConnectService.calculateHoursForDate(day, nextDayStr);
      }

      return { 
        jsonBody: { 
          success: true,
          period: {
            lastWeekStart: formatDate(lastWeekStart),
            thisWeekStart: formatDate(thisWeekStart),
            nextWeekStart: formatDate(nextWeekStart),
            nextWeekEnd: formatDate(nextWeekEnd)
          },
          recruiters: recruiters.length,
          divisions: divisions.length,
          hoursByDay
        } 
      };
    } catch (error) {
      context.error('Error generating report:', error);
      return { status: 500, jsonBody: { error: 'Failed to generate report', details: String(error) } };
    }
  }
});

// Health check
app.http('health', {
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