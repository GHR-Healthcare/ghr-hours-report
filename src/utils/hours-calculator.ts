import { clearConnectService } from '../services/clearconnect';
import { databaseService } from '../services/database';

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getWeekSunday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

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

export async function calculateAllHours(): Promise<{ processed: number; errors: string[] }> {
  const errors: string[] = [];
  let processed = 0;

  try {
    const includedRegions = await databaseService.getActiveRegionIds();
    const activeRecruiterIds = await databaseService.getActiveRecruiterIds();

    if (activeRecruiterIds.length === 0) {
      return { processed: 0, errors: ['No active recruiters configured'] };
    }

    const { lastWeekStart, nextWeekEnd } = getWeekDates();

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

        for (const [userId, hours] of Object.entries(hoursByRecruiter)) {
          await databaseService.upsertDailySnapshot(parseInt(userId), dateStr, hours as number);
        }

        processed++;
      } catch (error) {
        const errorMsg = `Error processing ${dateStr}: ${error}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    await databaseService.cleanupOldSnapshots();

  } catch (error) {
    errors.push(`Fatal error: ${error}`);
  }

  return { processed, errors };
}

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
      await databaseService.upsertDailySnapshot(parseInt(userId), dateStr, hours as number);
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
