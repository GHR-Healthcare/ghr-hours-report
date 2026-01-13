import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { calculateAllHours } from '../utils/hours-calculator';

// Email recipients - configure in environment variables
const getEmailRecipients = (): string[] => {
  const recipients = process.env.EMAIL_RECIPIENTS || '';
  return recipients.split(',').map(e => e.trim()).filter(e => e);
};

/**
 * Send daily hours report
 * Runs Mon-Fri at 8am, 12pm, 5pm ET
 */
async function sendDailyReport(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log('Daily Hours Report triggered');

  try {
    // First, calculate all hours from ClearConnect API
    context.log('Calculating hours from ClearConnect...');
    const calcResult = await calculateAllHours();
    context.log(`Processed ${calcResult.processed} days, ${calcResult.errors.length} errors`);

    if (calcResult.errors.length > 0) {
      context.log('Errors:', calcResult.errors);
    }

    // Get report data from database
    const reportData = await databaseService.getReportData();
    const weeklyTotals = await databaseService.getWeeklyTotals();

    // Generate email HTML (daily report doesn't include last week recap)
    const htmlBody = emailService.generateReportHtml(reportData, weeklyTotals, false);

    // Send email
    const recipients = getEmailRecipients();
    if (recipients.length > 0) {
      await emailService.sendEmail(recipients, 'Daily Hours', htmlBody);
      context.log(`Email sent to ${recipients.length} recipients`);
    } else {
      context.log('No email recipients configured');
    }

  } catch (error) {
    context.error('Error in sendDailyReport:', error);
    throw error;
  }
}

/**
 * Send Monday recap report (includes last week data)
 * Runs Monday at 8am ET
 */
async function sendMondayRecap(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log('Monday Recap Report triggered');

  try {
    // Calculate all hours
    const calcResult = await calculateAllHours();
    context.log(`Processed ${calcResult.processed} days, ${calcResult.errors.length} errors`);

    // Get report data
    const reportData = await databaseService.getReportData();
    const weeklyTotals = await databaseService.getWeeklyTotals();

    // Generate email HTML (include last week recap)
    const htmlBody = emailService.generateReportHtml(reportData, weeklyTotals, true);

    // Send email
    const recipients = getEmailRecipients();
    if (recipients.length > 0) {
      await emailService.sendEmail(recipients, 'Daily Hours - Last Week', htmlBody);
      context.log(`Monday recap email sent to ${recipients.length} recipients`);
    }

  } catch (error) {
    context.error('Error in sendMondayRecap:', error);
    throw error;
  }
}

// Schedule: 8am, 12pm, 5pm ET Monday-Friday
// CRON: sec min hour day month dayOfWeek
// Note: Azure Functions uses UTC by default
// ET is UTC-5 (EST) or UTC-4 (EDT)
// 8am ET = 13:00 UTC (EST) / 12:00 UTC (EDT)
// 12pm ET = 17:00 UTC (EST) / 16:00 UTC (EDT)
// 5pm ET = 22:00 UTC (EST) / 21:00 UTC (EDT)

// Using Eastern Time with WEBSITE_TIME_ZONE setting
app.timer('dailyReport8am', {
  schedule: '0 0 8 * * 1-5', // 8am Mon-Fri
  handler: sendDailyReport
});

app.timer('dailyReport12pm', {
  schedule: '0 0 12 * * 1-5', // 12pm Mon-Fri
  handler: sendDailyReport
});

app.timer('dailyReport5pm', {
  schedule: '0 0 17 * * 1-5', // 5pm Mon-Fri
  handler: sendDailyReport
});

// Monday 8am recap (runs slightly before the regular 8am)
app.timer('mondayRecap', {
  schedule: '0 0 8 * * 1', // 8am Monday only
  handler: sendMondayRecap
});

export { sendDailyReport, sendMondayRecap };
