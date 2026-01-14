import { ReportRow, WeeklyTotals } from '../types';

class EmailService {
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
          body { font-family: Arial, sans-serif; }
          table { border-collapse: collapse; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; }
          th { background-color: #f2f2f2; }
          h1 { color: #333; }
          h2 { color: #666; margin-top: 30px; }
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

    html += `
      </body>
      </html>
    `;

    return html;
  }

  async sendEmail(recipients: string[], subject: string, htmlContent: string): Promise<void> {
    // TODO: Implement Microsoft Graph email sending
    console.log(`Would send email to ${recipients.join(', ')} with subject: ${subject}`);
    console.log(`HTML length: ${htmlContent.length} characters`);
  }
}

export const emailService = new EmailService();
