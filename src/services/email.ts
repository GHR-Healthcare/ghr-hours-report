import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { ReportRow, WeeklyTotals } from '../types';

class EmailService {
  private graphClient: Client | null = null;

  /**
   * Initialize Microsoft Graph client
   */
  private async getClient(): Promise<Client> {
    if (this.graphClient) {
      return this.graphClient;
    }

    const credential = new ClientSecretCredential(
      process.env.AZURE_TENANT_ID || '',
      process.env.AZURE_CLIENT_ID || '',
      process.env.AZURE_CLIENT_SECRET || ''
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    this.graphClient = Client.initWithMiddleware({ authProvider });
    return this.graphClient;
  }

  /**
   * Send email via Microsoft Graph
   */
  async sendEmail(to: string[], subject: string, htmlBody: string): Promise<void> {
    const client = await this.getClient();
    const senderEmail = process.env.EMAIL_SENDER || 'contracts@ghresources.com';

    const message = {
      subject,
      body: {
        contentType: 'HTML',
        content: htmlBody
      },
      toRecipients: to.map(email => ({
        emailAddress: { address: email }
      }))
    };

    await client.api(`/users/${senderEmail}/sendMail`).post({ message });
  }

  /**
   * Generate HTML email matching the current format
   */
  generateReportHtml(
    reportData: ReportRow[],
    weeklyTotals: { lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null },
    includeLastWeek = false
  ): string {
    const cellStyle = 'padding: 8px 12px; text-align: center; border: 1px solid #555;';
    const headerStyle = `${cellStyle} background-color: #333; color: white; font-weight: bold;`;
    const greenStyle = `${cellStyle} background-color: #228B22; color: white;`;

    // Group data by division and week period
    const divisionData = new Map<string, Map<string, ReportRow[]>>();

    reportData.forEach(row => {
      if (!divisionData.has(row.division_name)) {
        divisionData.set(row.division_name, new Map());
      }
      const weekMap = divisionData.get(row.division_name)!;
      if (!weekMap.has(row.week_period)) {
        weekMap.set(row.week_period, []);
      }
      weekMap.get(row.week_period)!.push(row);
    });

    // Helper to check if goal is met
    const isGoalMet = (current: number, goal: number) => goal > 0 && current >= goal;

    // Helper to format a cell (green if goal met)
    const formatCell = (value: number, goal: number, weekTotal: number) => {
      const displayValue = value.toFixed(2);
      // For weekly total comparison
      if (isGoalMet(weekTotal, goal)) {
        return `<td style="${greenStyle}">${displayValue}</td>`;
      }
      return `<td style="${cellStyle}">${displayValue}</td>`;
    };

    // Generate Weekly Totals table
    let html = `
      <div style="font-family: Arial, sans-serif; background-color: #2b2b2b; color: white; padding: 20px;">
        <h2 style="margin-bottom: 20px;">Weekly Totals</h2>
        <table style="border-collapse: collapse; margin-bottom: 30px;">
          <tr>
            <th style="${headerStyle}"></th>
            <th style="${headerStyle}">Sun/Mon</th>
            <th style="${headerStyle}">Tues</th>
            <th style="${headerStyle}">Wed</th>
            <th style="${headerStyle}">Thu</th>
            <th style="${headerStyle}">Fri</th>
            <th style="${headerStyle}">Sat</th>
            <th style="${headerStyle}">GOALS</th>
          </tr>
    `;

    // Add rows for each week period
    const weekPeriods = includeLastWeek 
      ? [{ key: 'lastWeek', label: 'Last Week' }, { key: 'thisWeek', label: 'This Week' }, { key: 'nextWeek', label: 'Next Week' }]
      : [{ key: 'thisWeek', label: 'This Week' }, { key: 'nextWeek', label: 'Next Week' }];

    weekPeriods.forEach(({ key, label }) => {
      const data = weeklyTotals[key as keyof typeof weeklyTotals];
      if (data) {
        const goalMet = isGoalMet(data.total, data.goal);
        html += `
          <tr>
            <td style="${headerStyle}">${label}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.sun_mon.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.tue.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.wed.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.thu.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.fri.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.sat.toFixed(2)}</td>
            <td style="${goalMet ? greenStyle : cellStyle}">${data.goal.toFixed(0)}</td>
          </tr>
        `;
      } else {
        html += `
          <tr>
            <td style="${headerStyle}">${label}</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
            <td style="${cellStyle}">0</td>
          </tr>
        `;
      }
    });

    html += '</table>';

    // Generate table for each division
    const sortedDivisions = Array.from(divisionData.entries())
      .sort((a, b) => {
        const aOrder = reportData.find(r => r.division_name === a[0])?.division_order || 0;
        const bOrder = reportData.find(r => r.division_name === b[0])?.division_order || 0;
        return aOrder - bOrder;
      });

    for (const [divisionName, weekMap] of sortedDivisions) {
      html += `
        <h2 style="margin-top: 30px; margin-bottom: 20px;">${divisionName}</h2>
        <table style="border-collapse: collapse; margin-bottom: 30px;">
          <tr>
            <th style="${headerStyle}"></th>
            <th style="${headerStyle}">Sun/Mon</th>
            <th style="${headerStyle}">Tue</th>
            <th style="${headerStyle}">Wed</th>
            <th style="${headerStyle}">Thu</th>
            <th style="${headerStyle}">Fri</th>
            <th style="${headerStyle}">Sat</th>
            <th style="${headerStyle}">GOALS</th>
          </tr>
      `;

      // Get unique recruiters and sort by display order
      const recruiters = new Map<number, { name: string; goal: number; order: number }>();
      weekMap.forEach(rows => {
        rows.forEach(row => {
          if (!recruiters.has(row.user_id)) {
            recruiters.set(row.user_id, {
              name: row.recruiter_name,
              goal: row.weekly_goal,
              order: row.recruiter_order
            });
          }
        });
      });

      const sortedRecruiters = Array.from(recruiters.entries())
        .sort((a, b) => a[1].order - b[1].order);

      // For each recruiter, show their hours across days
      // We'll show "This Week" data for the daily breakdown
      const thisWeekData = weekMap.get('This Week') || [];
      
      for (const [userId, { name, goal }] of sortedRecruiters) {
        const recruiterRow = thisWeekData.find(r => r.user_id === userId);
        
        if (recruiterRow) {
          const weeklyTotal = recruiterRow.sun_mon + recruiterRow.tue + recruiterRow.wed + 
                            recruiterRow.thu + recruiterRow.fri + recruiterRow.sat;
          const goalMet = isGoalMet(weeklyTotal, goal);
          
          html += `
            <tr>
              <td style="${headerStyle}">${name}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.sun_mon.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.tue.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.wed.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.thu.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.fri.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${recruiterRow.sat.toFixed(2)}</td>
              <td style="${goalMet ? greenStyle : cellStyle}">${goal.toFixed(0)}</td>
            </tr>
          `;
        } else {
          html += `
            <tr>
              <td style="${headerStyle}">${name}</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">0</td>
              <td style="${cellStyle}">${goal.toFixed(0)}</td>
            </tr>
          `;
        }
      }

      html += '</table>';
    }

    html += '</div>';

    return html;
  }
}

export const emailService = new EmailService();
