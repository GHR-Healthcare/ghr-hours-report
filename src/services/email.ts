import { ReportRow, WeeklyTotals } from '../types';

class EmailService {
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private fromAddress: string;
  private senderUserId: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.tenantId = process.env.AZURE_TENANT_ID || '';
    this.clientId = process.env.AZURE_CLIENT_ID || '';
    this.clientSecret = process.env.AZURE_CLIENT_SECRET || '';
    this.fromAddress = process.env.EMAIL_FROM || 'contracts@ghrhealthcare.com';
    this.senderUserId = process.env.EMAIL_SENDER_USER || 'itadmin@ghrhealthcare.onmicrosoft.com';
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.tokenExpiry > now) {
      return this.accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get access token: ${response.status} - ${error}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    // Token usually valid for 1 hour, refresh 5 minutes early
    this.tokenExpiry = now + ((data.expires_in - 300) * 1000);
    
    return this.accessToken;
  }

  async sendEmail(recipients: string[], subject: string, htmlContent: string): Promise<void> {
    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      console.log('Email not configured. Missing Azure AD credentials.');
      console.log(`Would send email to ${recipients.join(', ')} with subject: ${subject}`);
      return;
    }

    const accessToken = await this.getAccessToken();

    const message = {
      message: {
        subject: subject,
        body: {
          contentType: 'HTML',
          content: htmlContent
        },
        from: {
          emailAddress: {
            address: this.fromAddress
          }
        },
        toRecipients: recipients.map(email => ({
          emailAddress: {
            address: email.trim()
          }
        }))
      },
      saveToSentItems: false
    };

    // Send as the itadmin user (who has SendAs permission for contracts@)
    const sendUrl = `https://graph.microsoft.com/v1.0/users/${this.senderUserId}/sendMail`;

    const response = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send email: ${response.status} - ${error}`);
    }

    console.log(`Email sent successfully to ${recipients.length} recipients`);
  }

  generateReportHtml(
    reportData: ReportRow[], 
    weeklyTotals: { lastWeek: WeeklyTotals | null; thisWeek: WeeklyTotals | null; nextWeek: WeeklyTotals | null },
    includeLastWeek: boolean = false
  ): string {
    const headerStyle = 'border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2; font-weight: bold;';
    const cellStyle = 'border: 1px solid #ddd; padding: 8px; text-align: right;';
    const greenStyle = 'border: 1px solid #ddd; padding: 8px; text-align: right; background-color: #90EE90;';

    const isGoalMet = (total: number, goal: number): boolean => {
      if (goal <= 0) return false;
      return total >= goal;
    };

    let html = `
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; }
          table { border-collapse: collapse; margin: 0 auto 20px auto; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f2f2f2; }
          h1 { color: #333; text-align: center; }
          h2 { color: #666; margin-top: 30px; text-align: center; }
        </style>
      </head>
      <body>
        <h1>Daily Hours</h1>
    `;

    // Weekly Totals Table
    html += `
      <h2>Weekly Totals</h2>
      <table>
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

    const weekRows: { label: string; data: WeeklyTotals | null }[] = [];
    
    if (includeLastWeek) {
      weekRows.push({ label: 'Last Week', data: weeklyTotals.lastWeek });
    }
    weekRows.push({ label: 'This Week', data: weeklyTotals.thisWeek });
    weekRows.push({ label: 'Next Week', data: weeklyTotals.nextWeek });

    for (const { label, data } of weekRows) {
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
    }

    html += '</table>';

    // Group data by division
    const divisionData = new Map<string, Map<string, ReportRow[]>>();
    
    for (const row of reportData) {
      if (!divisionData.has(row.division_name)) {
        divisionData.set(row.division_name, new Map());
      }
      const weekMap = divisionData.get(row.division_name)!;
      if (!weekMap.has(row.week_period)) {
        weekMap.set(row.week_period, []);
      }
      weekMap.get(row.week_period)!.push(row);
    }

    // Sort divisions by display order
    const sortedDivisions = Array.from(divisionData.entries())
      .sort((a, b) => {
        const aOrder = reportData.find(r => r.division_name === a[0])?.division_order || 0;
        const bOrder = reportData.find(r => r.division_name === b[0])?.division_order || 0;
        return aOrder - bOrder;
      });

    // Generate table for each division
    for (const [divisionName, weekMap] of sortedDivisions) {
      html += `
        <h2>${divisionName}</h2>
        <table>
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

      // Get "This Week" data for display
      const thisWeekData = weekMap.get('This Week') || [];
      
      // Track division totals
      let divTotalSunMon = 0;
      let divTotalTue = 0;
      let divTotalWed = 0;
      let divTotalThu = 0;
      let divTotalFri = 0;
      let divTotalSat = 0;
      let divTotalGoal = 0;
      
      for (const [userId, { name, goal }] of sortedRecruiters) {
        const recruiterRow = thisWeekData.find(r => r.user_id === userId);
        
        // Add to division totals
        divTotalGoal += goal;
        
        if (recruiterRow) {
          divTotalSunMon += recruiterRow.sun_mon;
          divTotalTue += recruiterRow.tue;
          divTotalWed += recruiterRow.wed;
          divTotalThu += recruiterRow.thu;
          divTotalFri += recruiterRow.fri;
          divTotalSat += recruiterRow.sat;
          
          // Use the most recent (highest) snapshot value to determine if goal is met
          // Each column is a snapshot of total weekly hours at that point in time
          const latestTotal = Math.max(
            recruiterRow.sun_mon, 
            recruiterRow.tue, 
            recruiterRow.wed, 
            recruiterRow.thu, 
            recruiterRow.fri, 
            recruiterRow.sat
          );
          const goalMet = isGoalMet(latestTotal, goal);
          
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
      
      // Add division total row
      // Use the most recent (highest) snapshot value to determine if goal is met
      const divLatestTotal = Math.max(divTotalSunMon, divTotalTue, divTotalWed, divTotalThu, divTotalFri, divTotalSat);
      const divGoalMet = isGoalMet(divLatestTotal, divTotalGoal);
      const totalRowStyle = 'border: 1px solid #ddd; padding: 8px; font-weight: bold;';
      const totalCellStyle = divGoalMet 
        ? 'border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold; background-color: #90EE90;'
        : 'border: 1px solid #ddd; padding: 8px; text-align: right; font-weight: bold;';
      
      html += `
        <tr>
          <td style="${totalRowStyle}">Total</td>
          <td style="${totalCellStyle}">${divTotalSunMon.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalTue.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalWed.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalThu.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalFri.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalSat.toFixed(2)}</td>
          <td style="${totalCellStyle}">${divTotalGoal.toFixed(0)}</td>
        </tr>
      `;

      html += '</table>';
    }

    html += `
      </body>
      </html>
    `;

    return html;
  }
}

export const emailService = new EmailService();
