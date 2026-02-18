import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { stackRankingService } from '../services/stackRanking';
import { configService } from '../services/config';

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
  
  // Get active user configs and build set of known Symplr IDs
  const activeConfigs = await databaseService.getUserConfigs(false);
  const activeHoursConfigs = activeConfigs.filter(c => c.on_hours_report);
  const activeUserIds = new Set(activeHoursConfigs.map(r => r.user_id));
  const knownSymplrIds = new Set(
    activeConfigs.filter(c => c.symplr_user_id != null).map(c => c.symplr_user_id!)
  );
  context.log(`Found ${activeHoursConfigs.length} active hours report users`);
  
  const thisWeekStart = formatDate(weekInfo.thisWeek.sunday);
  const nextWeekStart = formatDate(weekInfo.nextWeek.sunday);
  
  // On Sun/Mon (slot 0), clear out stale snapshots for This Week
  // These are leftover from when this week was "Next Week" last week
  // We start fresh each week for This Week
  if (snapshotSlot === 0) {
    const deletedThisWeek = await databaseService.clearWeekSnapshots(thisWeekStart);
    context.log(`Cleared ${deletedThisWeek} stale snapshots for This Week (${thisWeekStart}) - fresh start`);
    
    // Also clear Next Week to start fresh
    const deletedNextWeek = await databaseService.clearWeekSnapshots(nextWeekStart);
    context.log(`Cleared ${deletedNextWeek} stale snapshots for Next Week (${nextWeekStart}) - fresh start`);
  }
  
  // Collect all snapshots to save in a batch
  const snapshotsToSave: Array<{userId: number, weekStart: string, dayOfWeek: number, totalHours: number}> = [];
  
  // Process all three weeks
  const weeksToProcess: Array<{name: string, data: {sunday: Date, saturday: Date}}> = [
    { name: 'lastWeek', data: weekInfo.lastWeek },
    { name: 'thisWeek', data: weekInfo.thisWeek },
    { name: 'nextWeek', data: weekInfo.nextWeek }
  ];
  
  for (const { name: weekName, data: weekData } of weeksToProcess) {
    const weekStart = formatDate(weekData.sunday);
    const weekEnd = formatDate(weekData.saturday);
    
    context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}`);
    
    // Query orders directly from database
    const { hoursMap: hoursByRecruiter, orderCount } = await databaseService.getHoursFromOrders(weekStart, weekEnd);
    
    context.log(`${weekName}: Found ${orderCount} orders for ${hoursByRecruiter.size} staffers`);
    
    // Check for new recruiters and auto-add them (only for thisWeek to avoid duplicates)
    // Uses symplr_user_id to avoid cross-system ID collisions
    if (weekName === 'thisWeek') {
      for (const [userId] of hoursByRecruiter) {
        if (!knownSymplrIds.has(userId)) {
          const exists = await databaseService.userConfigExistsByAtsId('symplr', userId);
          if (!exists) {
            try {
              const userName = await databaseService.getUserNameFromCtmsync(userId);

              await databaseService.createRecruiter({
                user_id: userId,
                user_name: userName || `User ${userId}`,
                division_id: 1,
                weekly_goal: 0,
                display_order: 99
              });

              activeUserIds.add(userId);
              knownSymplrIds.add(userId);
              context.log(`Auto-added recruiter: ${userName} (Symplr ID: ${userId})`);
            } catch (addError) {
              context.log(`Error adding recruiter ${userId}: ${addError}`);
            }
          }
        }
      }
    }
    
    // Collect snapshots for batch save
    for (const [userId, hours] of hoursByRecruiter) {
      if (activeUserIds.has(userId)) {
        snapshotsToSave.push({
          userId,
          weekStart,
          dayOfWeek: snapshotSlot,
          totalHours: Math.round(hours * 100) / 100
        });
      }
    }
  }
  
  // Save all snapshots in batch
  context.log(`Saving ${snapshotsToSave.length} snapshots in batch...`);
  await databaseService.upsertWeeklySnapshotsBatch(snapshotsToSave);
  context.log(`Batch save complete`);
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
  const recipients = await configService.getList('HOURS_REPORT_TO_EMAIL');

  if (recipients.length === 0) {
    context.warn('No hours report recipients configured. Set HOURS_REPORT_TO_EMAIL in Settings.');
    return;
  }

  const fromAddress = await configService.get('HOURS_REPORT_FROM_EMAIL', 'contracts@ghrhealthcare.com');
  await emailService.sendEmail(recipients, subject, html, fromAddress);
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
  schedule: '0 15 8 * * 1', // 8:15 AM EST Monday (after 8 AM daily calc finishes)
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== MONDAY WEEKLY RECAP TRIGGERED (8:15 AM EST) ===');

    try {
      // The 8 AM daily report calculates fresh data including the current week.
      // This recap runs 15 min later so that data is available as "Next Week"
      // when viewed from the offset -1 perspective.

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
// WEEKLY STACK RANKING - Monday 8:30 AM EST
// Calculates last week's stack ranking and emails to separate recipient list
// Runs after the 8:15 AM recap so all data is fresh
// =============================================================================
app.timer('weeklyStackRanking', {
  schedule: '0 30 8 * * 1', // 8:30 AM EST Monday
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== WEEKLY STACK RANKING TRIGGERED (8:30 AM EST Monday) ===');

    try {
      const { weekStart, weekEnd } = stackRankingService.getLastWeekBoundaries();
      context.log(`Calculating stack ranking for ${weekStart} to ${weekEnd}`);

      const { rows, totals } = await stackRankingService.calculateRanking(weekStart, weekEnd);
      context.log(`Stack ranking calculated: ${rows.length} recruiters ranked`);

      const html = emailService.generateStackRankingHtml(rows, totals, weekStart, weekEnd);

      const recipients = await configService.getList('STACK_RANKING_TO_EMAIL');

      if (recipients.length === 0) {
        context.warn('No stack ranking recipients configured. Set STACK_RANKING_TO_EMAIL in Settings.');
        return;
      }

      const fromAddress = await configService.get('STACK_RANKING_FROM_EMAIL', 'contracts@ghrhealthcare.com');
      await emailService.sendEmail(recipients, `GHR Stack Ranking - Week of ${weekStart}`, html, fromAddress);
      context.log(`Stack ranking email sent to ${recipients.length} recipients`);
    } catch (error) {
      context.error('Error in weekly stack ranking:', error);
      throw error;
    }
  }
});

// =============================================================================
// NIGHTLY CLEANUP & USER SYNC - 2:00 AM EST (07:00 UTC)
// Removes old snapshot data and syncs users from both ATS systems
// =============================================================================
app.timer('nightlyCleanup', {
  schedule: '0 0 2 * * *', // 2:00 AM EST
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('=== NIGHTLY CLEANUP & USER SYNC TRIGGERED (2:00 AM EST) ===');

    try {
      // 1. Cleanup old snapshots
      const deleted = await databaseService.cleanupOldSnapshots();
      context.log(`Cleanup complete: ${deleted} old snapshots removed`);

      const stackDeleted = await databaseService.cleanupOldStackRankingSnapshots();
      context.log(`Stack ranking cleanup: ${stackDeleted} old snapshots removed`);

      // 2. Sync divisions from Bullhorn CorporationDepartment + Symplr static divisions
      const newDivisions = await databaseService.syncDivisionsFromAts();
      if (newDivisions > 0) context.log(`Created ${newDivisions} new divisions from ATS`);

      // 3. Sync users from both ATS systems (90-day lookback)
      // This ensures user_config entries exist with proper divisions
      // before anyone runs Financials or Stack Ranking during the day
      context.log('Starting nightly user sync...');
      const now = new Date();
      const syncEnd = formatDate(now);
      const syncStart = new Date(now);
      syncStart.setDate(syncStart.getDate() - 90);
      const syncStartStr = formatDate(syncStart);

      const checkedAtsIds = new Set<string>();

      const symplrData = await databaseService.getSymplrPlacementData(syncStartStr, syncEnd);
      await stackRankingService.autoDiscoverUsers(symplrData, 'symplr', checkedAtsIds);

      const bullhornData = await databaseService.getBullhornPlacementData(syncStartStr, syncEnd);
      await stackRankingService.autoDiscoverUsers(bullhornData, 'bullhorn', checkedAtsIds);

      context.log(`User sync complete: checked ${symplrData.length} Symplr + ${bullhornData.length} Bullhorn placement records`);
    } catch (error) {
      context.error('Error in nightly cleanup/sync:', error);
      throw error;
    }
  }
});
