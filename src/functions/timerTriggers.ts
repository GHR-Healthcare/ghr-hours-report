import { app, InvocationContext, Timer } from '@azure/functions';
import { databaseService } from '../services/database';
import { emailService } from '../services/email';
import { calculateAllHours } from '../utils/hours-calculator';

const getEmailRecipients = (): string[] => {
  const recipients = process.env.EMAIL_RECIPIENTS || '';
  return recipients.split(',').map(e => e.trim()).filter(e => e);
};

async function sendDailyReport(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log('Daily Hours Report triggered');

  try {
    context.log('Calculating hours from ClearConnect...');
    const calcResult = await calculateAllHours();
    context.log(`Processed ${calcResult.processed} days, ${calcResult.errors.length} errors`);

    if (calcResult.errors.length > 0) {
      context.log('Errors:', calcResult.errors);
    }

    const reportData = await databaseService.getReportData();
    const weeklyTotals = await databaseService.getWeeklyTotals();

    const htmlBody = emailService.generateReportHtml(reportData, weeklyTotals, false);

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

async function sendMondayRecap(myTimer: Timer, context: InvocationContext): Promise<void> {
  context.log('Monday Recap Report triggered');

  try {
    const calcResult = await calculateAllHours();
    context.log(`Processed ${calcResult.processed} days, ${calcResult.errors.length} errors`);

    const reportData = await databaseService.getReportData();
    const weeklyTotals = await databaseService.getWeeklyTotals();

    const htmlBody = emailService.generateReportHtml(reportData, weeklyTotals, true);

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

app.timer('dailyReport8am', {
  schedule: '0 0 8 * * 1-5',
  handler: sendDailyReport
});

app.timer('dailyReport12pm', {
  schedule: '0 0 12 * * 1-5',
  handler: sendDailyReport
});

app.timer('dailyReport5pm', {
  schedule: '0 0 17 * * 1-5',
  handler: sendDailyReport
});

app.timer('mondayRecap', {
  schedule: '0 0 8 * * 1',
  handler: sendMondayRecap
});

export { sendDailyReport, sendMondayRecap };
