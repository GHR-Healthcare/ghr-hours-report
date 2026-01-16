import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { clearConnectService } from '../services/clearconnect';

// Helper function to get week boundaries
function getWeekInfo(forDate?: Date) {
  const now = forDate || new Date();
  const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, 2=Tue, etc.
  
  // Snapshot slot: 0=Sun/Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat
  let snapshotDayOfWeek: number;
  if (currentDayOfWeek === 0 || currentDayOfWeek === 1) {
    snapshotDayOfWeek = 0;
  } else {
    snapshotDayOfWeek = currentDayOfWeek - 1;
  }
  
  // This week Sunday
  const thisWeekSunday = new Date(now);
  thisWeekSunday.setDate(now.getDate() - currentDayOfWeek);
  thisWeekSunday.setHours(0, 0, 0, 0);
  
  const thisWeekSaturday = new Date(thisWeekSunday);
  thisWeekSaturday.setDate(thisWeekSunday.getDate() + 6);
  
  // Next week
  const nextWeekSunday = new Date(thisWeekSunday);
  nextWeekSunday.setDate(thisWeekSunday.getDate() + 7);
  const nextWeekSaturday = new Date(nextWeekSunday);
  nextWeekSaturday.setDate(nextWeekSunday.getDate() + 6);
  
  // Last week
  const lastWeekSunday = new Date(thisWeekSunday);
  lastWeekSunday.setDate(thisWeekSunday.getDate() - 7);
  const lastWeekSaturday = new Date(lastWeekSunday);
  lastWeekSaturday.setDate(lastWeekSunday.getDate() + 6);
  
  return {
    currentDayOfWeek,
    snapshotDayOfWeek,
    lastWeek: { sunday: lastWeekSunday, saturday: lastWeekSaturday },
    thisWeek: { sunday: thisWeekSunday, saturday: thisWeekSaturday },
    nextWeek: { sunday: nextWeekSunday, saturday: nextWeekSaturday }
  };
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// Calculate weekly hours for all weeks and save snapshots
// Only updates the current day's slot, preserving previous days' snapshots
async function calculateWeeklyHours(context: InvocationContext, snapshotSlotOverride?: number): Promise<void> {
  const weekInfo = getWeekInfo();
  const snapshotSlot = snapshotSlotOverride !== undefined ? snapshotSlotOverride : weekInfo.snapshotDayOfWeek;
  
  context.log(`Calculating weekly hours, snapshot slot: ${snapshotSlot} (${['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][snapshotSlot]})`);
  
  // Get region IDs from database
  const regionIds = await databaseService.getActiveRegionIds();
  const regionIdString = regionIds.join(',');
  context.log(`Using ${regionIds.length} region IDs from database`);
  
  // Get active, non-deleted recruiters only
  const activeRecruiters = await databaseService.getRecruiters(false);
  const activeUserIds = new Set(activeRecruiters.map(r => r.user_id));
  context.log(`Found ${activeUserIds.size} active recruiters`);
  
  // Process all three weeks
  const weeksToProcess: Array<{name: string, data: {sunday: Date, saturday: Date}}> = [
    { name: 'lastWeek', data: weekInfo.lastWeek },
    { name: 'thisWeek', data: weekInfo.thisWeek },
    { name: 'nextWeek', data: weekInfo.nextWeek }
  ];
  
  // Process each week
  for (const { name: weekName, data: weekData } of weeksToProcess) {
    const weekStart = formatDate(weekData.sunday);
    const weekEnd = formatDate(weekData.saturday);
    
    context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}`);
    
    // Fetch day by day to avoid API pagination limits (3000 record limit)
    let allOrders: any[] = [];
    const currentDate = new Date(weekData.sunday);
    
    while (currentDate <= weekData.saturday) {
      const dateStr = formatDate(currentDate);
      context.log(`  Fetching ${dateStr}...`);
      
      const dayOrders = await clearConnectService.getOrders(dateStr, dateStr, regionIdString);
      
      // Filter to only orders starting on this date
      const filteredOrders = dayOrders.filter((order: any) => {
        const orderDate = order.shiftStartTime.split('T')[0].split(' ')[0];
        return orderDate === dateStr;
      });
      
      allOrders = allOrders.concat(filteredOrders);
      context.log(`    Got ${filteredOrders.length} orders for ${dateStr}`);
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    context.log(`${weekName}: ${allOrders.length} total orders`);
    
    // Get unique temps
    const tempIds = [...new Set(allOrders.map((o: any) => o.tempId).filter((id: any) => id))];
    const tempsMap = await clearConnectService.getTempsBatch(tempIds as string[]);
    
    // Calculate hours by recruiter (only for active recruiters)
    const hoursByRecruiter: Record<number, number> = {};
    
    for (const order of allOrders) {
      const temp = tempsMap.get(order.tempId);
      if (!temp || !temp.staffingSpecialist) continue;
      
      const recruiterId = parseInt(temp.staffingSpecialist, 10);
      
      // Check if this is a new recruiter we haven't seen before
      if (!activeUserIds.has(recruiterId)) {
        // Check if recruiter exists at all (including deleted/inactive)
        const exists = await databaseService.recruiterExists(recruiterId);
        if (!exists) {
          // Auto-add new recruiter - they'll be active by default
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
            
            // Add to active set so their hours get counted
            activeUserIds.add(recruiterId);
            context.log(`Auto-added recruiter: ${userName} (ID: ${recruiterId})`);
          } catch (addError) {
            context.log(`Error adding recruiter ${recruiterId}: ${addError}`);
          }
        }
        // If recruiter exists but is deleted/inactive, skip their hours
        if (!activeUserIds.has(recruiterId)) {
          continue;
        }
      }
      
      const startTime = new Date(order.shiftStartTime);
      const endTime = new Date(order.shiftEndTime);
      
      // Give credit for full shift time (no lunch deduction)
      const totalMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60);
      const hours = totalMinutes / 60;
      
      if (!hoursByRecruiter[recruiterId]) {
        hoursByRecruiter[recruiterId] = 0;
      }
      hoursByRecruiter[recruiterId] += hours;
    }
    
    // Save snapshots - only updates the specified slot, previous days are preserved
    for (const [userIdStr, hours] of Object.entries(hoursByRecruiter)) {
      const roundedHours = Math.round(hours * 100) / 100;
      await databaseService.upsertWeeklySnapshot(
        parseInt(userIdStr),
        weekStart,
        snapshotSlot,
        roundedHours
      );
    }
  }
}

// Send email report
async function sendReportEmail(context: InvocationContext, subject: string): Promise<void> {
  // Get report data and generate HTML - always includes all 3 weeks
  const reportData = await databaseService.getReportData();
  const weeklyTotals = await databaseService.getWeeklyTotals();
  const html = emailService.generateReportHtml(reportData, weeklyTotals, true);

  // Send email
  const recipients = (process.env.EMAIL_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
  
  if (recipients.length === 0) {
    context.warn('No email recipients configured. Set EMAIL_RECIPIENTS environment variable.');
    return;
  }

  await emailService.sendEmail(recipients, subject, html);
  context.log(`Email sent to ${recipients.length} recipients: ${subject}`);
}

// =============================================================================
// NIGHTLY SNAPSHOT - 11:59 PM EST (04:59 UTC next day)
// Captures the final hours for the current day's slot every night
// This ensures each day's column in the report has a final snapshot
// =============================================================================
app.timer('nightlySnapshot', {
  schedule: '0 59 4 * * *', // 11:59 PM EST = 4:59 AM UTC next day
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== NIGHTLY SNAPSHOT TRIGGERED (11:59 PM EST) ===');
    
    try {
      // Calculate and save snapshot for today's slot
      await calculateWeeklyHours(context);
      context.log('Nightly snapshot complete');
    } catch (error) {
      context.error('Error in nightly snapshot:', error);
      throw error;
    }
  }
});

// =============================================================================
// MONDAY 8 AM - Weekly Recap Email
// Sends a complete recap of last week with all daily snapshots filled in
// The Saturday night snapshot should have run, so last week is complete
// =============================================================================
app.timer('mondayWeeklyRecap', {
  schedule: '0 0 13 * * 1', // 8:00 AM EST Monday = 13:00 UTC
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== MONDAY WEEKLY RECAP TRIGGERED (8:00 AM EST) ===');
    
    try {
      // No recalculation needed - use the snapshots saved throughout last week
      // Saturday's nightly snapshot already captured the final totals
      
      // Send the weekly recap email
      await sendReportEmail(context, 'Weekly Hours Recap - Previous Week Final');
      
      context.log('Monday weekly recap complete');
    } catch (error) {
      context.error('Error in Monday weekly recap:', error);
      throw error;
    }
  }
});

// =============================================================================
// DAILY EMAILS - Monday through Friday at 8 AM, 12 PM, and 5 PM EST
// Regular progress updates showing all 3 weeks (last, this, next)
// =============================================================================

// 8:00 AM EST (13:00 UTC) - Mon-Fri
app.timer('dailyReport8am', {
  schedule: '0 0 13 * * 1-5', // 8:00 AM EST Mon-Fri
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== 8 AM DAILY REPORT TRIGGERED ===');
    
    try {
      await calculateWeeklyHours(context);
      await sendReportEmail(context, 'Daily Hours Report - Morning Update');
      context.log('8 AM daily report complete');
    } catch (error) {
      context.error('Error in 8 AM daily report:', error);
      throw error;
    }
  }
});

// 12:00 PM EST (17:00 UTC) - Mon-Fri
app.timer('dailyReport12pm', {
  schedule: '0 0 17 * * 1-5', // 12:00 PM EST Mon-Fri
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== 12 PM DAILY REPORT TRIGGERED ===');
    
    try {
      await calculateWeeklyHours(context);
      await sendReportEmail(context, 'Daily Hours Report - Midday Update');
      context.log('12 PM daily report complete');
    } catch (error) {
      context.error('Error in 12 PM daily report:', error);
      throw error;
    }
  }
});

// 5:00 PM EST (22:00 UTC) - Mon-Fri
app.timer('dailyReport5pm', {
  schedule: '0 0 22 * * 1-5', // 5:00 PM EST Mon-Fri
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== 5 PM DAILY REPORT TRIGGERED ===');
    
    try {
      await calculateWeeklyHours(context);
      await sendReportEmail(context, 'Daily Hours Report - End of Day Update');
      context.log('5 PM daily report complete');
    } catch (error) {
      context.error('Error in 5 PM daily report:', error);
      throw error;
    }
  }
});

// =============================================================================
// NIGHTLY CLEANUP - 2:00 AM EST (07:00 UTC)
// Removes old snapshot data to keep database clean
// =============================================================================
app.timer('nightlyCleanup', {
  schedule: '0 0 7 * * *', // 2:00 AM EST = 7:00 AM UTC
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== NIGHTLY CLEANUP TRIGGERED (2:00 AM EST) ===');
    
    try {
      const deleted = await databaseService.cleanupOldSnapshots();
      context.log(`Cleanup complete: ${deleted} old snapshots removed`);
    } catch (error) {
      context.error('Error in nightly cleanup:', error);
      throw error;
    }
  }
});
