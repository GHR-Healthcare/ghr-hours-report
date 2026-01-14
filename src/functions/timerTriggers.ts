import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { calculateAllHours } from '../utils/hours-calculator';

// Calculate hours and send email
async function runReportAndEmail(context: InvocationContext, includeLastWeek: boolean = false): Promise<void> {
  try {
    // First, calculate all hours from ClearConnect
    context.log('Calculating hours from ClearConnect...');
    const calcResult = await calculateAllHours();
    context.log(`Calculation complete: ${calcResult.processed} days processed, ${calcResult.errors.length} errors, ${calcResult.newRecruiters.length} new recruiters`);

    if (calcResult.errors.length > 0) {
      context.warn('Calculation errors:', calcResult.errors);
    }

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
