import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { clearConnectService } from '../services/clearconnect';

// Helper function to get week boundaries and day of week
function getWeekInfo() {
  const now = new Date();
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
async function calculateWeeklyHours(context: InvocationContext): Promise<void> {
  const weekInfo = getWeekInfo();
  
  context.log(`Calculating weekly hours, snapshot day: ${weekInfo.snapshotDayOfWeek} (${['Sun/Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekInfo.snapshotDayOfWeek]})`);
  
  // Get configured recruiters
  const configuredRecruiters = await databaseService.getRecruiters(true);
  const configuredUserIds = new Set(configuredRecruiters.map(r => r.user_id));
  
  // Determine which weeks to process
  // Always process this week and next week
  // Only process last week on Sun/Mon (to capture final totals for Monday morning report)
  const weeksToProcess: Array<{name: string, data: {sunday: Date, saturday: Date}}> = [
    { name: 'thisWeek', data: weekInfo.thisWeek },
    { name: 'nextWeek', data: weekInfo.nextWeek }
  ];
  
  if (weekInfo.snapshotDayOfWeek === 0) {
    weeksToProcess.unshift({ name: 'lastWeek', data: weekInfo.lastWeek });
  }
  
  // Process each week
  for (const { name: weekName, data: weekData } of weeksToProcess) {
    const weekStart = formatDate(weekData.sunday);
    const weekEnd = formatDate(weekData.saturday);
    
    context.log(`Processing ${weekName}: ${weekStart} to ${weekEnd}`);
    
    // Get all orders for the week
    const allOrders = await clearConnectService.getOrders(weekStart, weekEnd);
    
    // Filter orders by region
    const orders = allOrders.filter(order => {
      const regionName = (order.regionName || '').toLowerCase();
      return regionName.includes('nursing') || regionName.includes('acute') || regionName.includes('temp to perm');
    });
    
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
    
    // Save snapshots - only updates current day slot, previous days are preserved
    for (const [userIdStr, hours] of Object.entries(hoursByRecruiter)) {
      const roundedHours = Math.round(hours * 100) / 100;
      await databaseService.upsertWeeklySnapshot(
        parseInt(userIdStr),
        weekStart,
        weekInfo.snapshotDayOfWeek,
        roundedHours
      );
    }
  }
}

// Calculate hours and send email
async function runReportAndEmail(context: InvocationContext, includeLastWeek: boolean = false): Promise<void> {
  try {
    // First, calculate weekly hours from ClearConnect
    context.log('Calculating weekly hours from ClearConnect...');
    await calculateWeeklyHours(context);
    context.log('Calculation complete');

    // Get report data and generate HTML
    const reportData = await databaseService.getReportData();
    const weeklyTotals = await databaseService.getWeeklyTotals();
    const html = emailService.generateReportHtml(reportData, weeklyTotals, includeLastWeek);

    // Send email
    const recipients = (process.env.EMAIL_RECIPIENTS || '').split(',').map(e => e.trim()).filter(e => e);
    
    if (recipients.length === 0) {
      context.warn('No email recipients configured. Set EMAIL_RECIPIENTS environment variable.');
      return;
    }

    const subject = includeLastWeek ? 'Daily Hours - Last Week' : 'Daily Hours';
    await emailService.sendEmail(recipients, subject, html);
    
    context.log(`Email sent to ${recipients.length} recipients`);
  } catch (error) {
    context.error('Error in report and email:', error);
    throw error;
  }
}

// Monday-Friday 8:00 AM EST (13:00 UTC)
app.timer('dailyReport8am', {
  schedule: '0 0 13 * * 1-5',
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('8 AM daily report triggered');
    
    // Check if Monday - include last week recap
    const today = new Date();
    const isMonday = today.getDay() === 1;
    
    await runReportAndEmail(context, false);
    
    // On Monday, also send last week recap
    if (isMonday) {
      context.log('Monday detected - sending last week recap');
      await runReportAndEmail(context, true);
    }
  }
});

// Monday-Friday 12:00 PM EST (17:00 UTC)
app.timer('dailyReport12pm', {
  schedule: '0 0 17 * * 1-5',
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('12 PM daily report triggered');
    await runReportAndEmail(context, false);
  }
});

// Monday-Friday 5:00 PM EST (22:00 UTC)
app.timer('dailyReport5pm', {
  schedule: '0 0 22 * * 1-5',
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('5 PM daily report triggered');
    await runReportAndEmail(context, false);
  }
});

// Nightly cleanup - 2:00 AM EST (07:00 UTC)
app.timer('nightlyCleanup', {
  schedule: '0 0 7 * * *',
  handler: async (timer: Timer, context: InvocationContext): Promise<void> => {
    context.log('Nightly cleanup triggered');
    try {
      const deleted = await databaseService.cleanupOldSnapshots();
      context.log(`Cleanup complete: ${deleted} old snapshots removed`);
    } catch (error) {
      context.error('Error in nightly cleanup:', error);
      throw error;
    }
  }
});
