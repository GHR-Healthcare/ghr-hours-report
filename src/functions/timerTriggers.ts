import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';

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
// Now queries orders table directly instead of using ClearConnect API
async function calculateWeeklyHours(context: InvocationContext, snapshotSlotOverride?: number): Promise<void> {
  const weekInfo = getWeekInfo();
  const snapshotSlot = snapshotSlotOverride !== undefined ? snapshotSlotOverride : weekInfo.snapshotDayOfWeek;
  
  context.log(`Calculating weekly hours, snapshot slot: ${snapshotSlot} (${['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][snapshotSlot]})`);
  
  // Get active, non-deleted recruiters only
  const activeRecruiters = await databaseService.getRecruiters(false);
  const activeUserIds = new Set(activeRecruiters.map(r => r.user_id));
  context.log(`Found ${activeUserIds.size} active recruiters`);
  
  // Process all three weeks
  const weeksToProcess: Array<{name: string, data: {sunday: Date, saturday: Date}, slot: number}> = [
    { name: 'lastWeek', data: weekInfo.lastWeek, slot: snapshotSlot },
    { name: 'thisWeek', data: weekInfo.thisWeek, slot: snapshotSlot },
    // Next Week always saves to slot 0 (Sun/Mon) - it's a forecast, not daily tracking
    { name: 'nextWeek', data: weekInfo.nextWeek, slot: 0 }
  ];
  
  // Process each week
  for (const { name: weekName, data: weekData, slot: weekSlot } of weeksToProcess) {
    const weekStart = formatDate(weekData.sunday);
    const weekEnd = formatDate(weekData.saturday);
    
    context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}, saving to slot ${weekSlot}`);
    
    // Query orders directly from database - much faster and more accurate
    const { hoursMap: hoursByRecruiter, orderCount } = await databaseService.getHoursFromOrders(weekStart, weekEnd);
    
    context.log(`${weekName}: Found ${orderCount} orders for ${hoursByRecruiter.size} staffers`);
    
    // Check for new recruiters and auto-add them (only for thisWeek to avoid duplicates)
    if (weekName === 'thisWeek') {
      for (const [userId, hours] of hoursByRecruiter) {
        if (!activeUserIds.has(userId)) {
          // Check if recruiter exists at all (including deleted/inactive)
          const exists = await databaseService.recruiterExists(userId);
          if (!exists) {
            // Auto-add new recruiter - they'll be active by default
            try {
              const userName = await databaseService.getUserNameFromCtmsync(userId);
              
              await databaseService.createRecruiter({
                user_id: userId,
                user_name: userName || `User ${userId}`,
                division_id: 1,
                weekly_goal: 0,
                display_order: 99
              });
              
              // Add to active set so their hours get counted
              activeUserIds.add(userId);
              context.log(`Auto-added recruiter: ${userName} (ID: ${userId})`);
            } catch (addError) {
              context.log(`Error adding recruiter ${userId}: ${addError}`);
            }
          }
        }
      }
    }
    
    // Save snapshots - only for active recruiters
    for (const [userId, hours] of hoursByRecruiter) {
      if (activeUserIds.has(userId)) {
        const roundedHours = Math.round(hours * 100) / 100;
        await databaseService.upsertWeeklySnapshot(
          userId,
          weekStart,
          weekSlot,
          roundedHours
        );
      }
    }
  }
}

// Send email report
// weekOffset: 0 for current week perspective, -1 for previous week perspective (Monday recap)
async function sendReportEmail(context: InvocationContext, subject: string, weekOffset: number = 0): Promise<void> {
  // Get report data and generate HTML - always includes all 3 weeks
  let reportData;
  let weeklyTotals;
  
  if (weekOffset === 0) {
    // Normal daily report - use current week perspective
    reportData = await databaseService.getReportData();
    weeklyTotals = await databaseService.getWeeklyTotals();
  } else {
    // Monday recap or other offset report
    reportData = await databaseService.getReportDataWithOffset(weekOffset);
    weeklyTotals = await databaseService.getWeeklyTotalsWithOffset(weekOffset);
  }
  
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
  schedule: '0 59 23 * * *', // 11:59 PM EST
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
// Uses weekOffset of -1 to shift perspective back one week
// =============================================================================
app.timer('mondayWeeklyRecap', {
  schedule: '0 0 8 * * 1', // 8:00 AM EST Monday
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== MONDAY WEEKLY RECAP TRIGGERED (8:00 AM EST) ===');
    
    try {
      // No recalculation needed - use the snapshots saved throughout last week
      // Saturday's nightly snapshot already captured the final totals
      
      // Send the weekly recap email with week offset -1
      // This shifts the perspective so "This Week" shows the completed week
      await sendReportEmail(context, 'Weekly Hours Recap - Previous Week Final', -1);
      
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
  schedule: '0 0 8 * * 1-5', // 8:00 AM EST Mon-Fri
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
  schedule: '0 0 12 * * 1-5', // 12:00 PM EST Mon-Fri
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
  schedule: '0 0 17 * * 1-5', // 5:00 PM EST Mon-Fri
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
  schedule: '0 0 2 * * *', // 2:00 AM EST
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
