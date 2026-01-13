import { clearConnectService } from '../services/clearconnect';
import { databaseService } from '../services/database';

/**
 * Get date string in YYYY-MM-DD format
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get the Sunday of the week containing the given date
 */
export function getWeekSunday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get dates for last week, this week, and next week
 */
export function getWeekDates(): {
  lastWeekStart: Date;
  thisWeekStart: Date;
  nextWeekStart: Date;
  nextWeekEnd: Date;
} {
  const now = new Date();
  const thisWeekStart = getWeekSunday(now);
  
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 6);

  return { lastWeekStart, thisWeekStart, nextWeekStart, nextWeekEnd };
}

/**
 * Calculate and store hours for all dates in the 3-week window
 */
export async function calculateAllHours(): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    // Get config data
    const includedRegions = await databaseService.getActiveRegionIds();
    const activeRecruiterIds = await databaseService.getActiveRecruiterIds();

    if (activeRecruiterIds.length === 0) {
      return { processed: 0, errors: ['No active recruiters configured'] };
    }

    // Get date range
    const { lastWeekStart, nextWeekEnd } = getWeekDates();

    // Process each day in the range
    const currentDate = new Date(lastWeekStart);
    while (currentDate <= nextWeekEnd) {
      const dateStr = formatDate(currentDate);
      const nextDateStr = formatDate(new Date(currentDate.getTime() + 24 * 60 * 60 * 1000));

      try {
        console.log(`Processing ${dateStr}...`);
        
        const hoursByRecruiter = await clearConnectService.calculateHoursForDate(
          dateStr,
          nextDateStr,
          includedRegions,
          activeRecruiterIds
        );

        // Save to database
        for (const [userId, hours] of Object.entries(hoursByRecruiter)) {
          await databaseService.upsertDailySnapshot(parseInt(userId), dateStr, hours);
        }

        processed++;
      } catch (error) {
        const errorMsg = `Error processing ${dateStr}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Cleanup old snapshots
    await databaseService.cleanupOldSnapshots();

  } catch (error) {
    errors.push(`Fatal error: ${error}`);
  }

  return { processed, errors };
}

/**
 * Calculate hours for a single date
 */
export async function calculateHoursForDate(targetDate: Date): Promise<{ success: boolean; error?: string }> {
  try {
    const includedRegions = await databaseService.getActiveRegionIds();
    const activeRecruiterIds = await databaseService.getActiveRecruiterIds();

    const dateStr = formatDate(targetDate);
    const nextDateStr = formatDate(new Date(targetDate.getTime() + 24 * 60 * 60 * 1000));

    const hoursByRecruiter = await clearConnectService.calculateHoursForDate(
      dateStr,
      nextDateStr,
      includedRegions,
      activeRecruiterIds
    );

    for (const [userId, hours] of Object.entries(hoursByRecruiter)) {
      await databaseService.upsertDailySnapshot(parseInt(userId), dateStr, hours);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
