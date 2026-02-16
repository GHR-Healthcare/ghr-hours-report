import { databaseService } from './database';
import {
  DivisionAtsMapping,
  PlacementData,
  StackRankingRow,
  StackRankingTotals,
} from '../types';

class StackRankingService {
  /**
   * Calculate stack ranking for a given week.
   * Queries each ATS mirror (filtered by division mapping), merges results,
   * computes GM$, GP%, ranks by GM$ descending, and compares to prior week.
   */
  async calculateRanking(
    weekStart: string,
    weekEnd: string
  ): Promise<{ rows: StackRankingRow[]; totals: StackRankingTotals }> {
    // 1. Read division-to-ATS mappings
    const mappings = await databaseService.getDivisionAtsMappings();
    const symplrDivisions = new Set(
      mappings.filter(m => m.ats_system === 'symplr').map(m => m.division_id)
    );
    const bullhornDivisions = new Set(
      mappings.filter(m => m.ats_system === 'bullhorn').map(m => m.division_id)
    );

    // 2. Query each ATS mirror in parallel
    const [symplrData, bullhornData] = await Promise.all([
      symplrDivisions.size > 0
        ? databaseService.getSymplrPlacementData(weekStart, weekEnd)
        : Promise.resolve([] as PlacementData[]),
      bullhornDivisions.size > 0
        ? databaseService.getBullhornPlacementData(weekStart, weekEnd)
        : Promise.resolve([] as PlacementData[]),
    ]);

    // 3. Filter by mapped divisions
    const filteredSymplr = symplrData.filter(d => symplrDivisions.has(d.division_id));
    const filteredBullhorn = bullhornData.filter(d => bullhornDivisions.has(d.division_id));

    // 4. Merge all placement data
    const allData: PlacementData[] = [...filteredSymplr, ...filteredBullhorn];

    // 5. Aggregate by recruiter (in case a recruiter appears in multiple data sources)
    const recruiterMap = new Map<number, {
      recruiter_name: string;
      division_name: string;
      division_id: number;
      head_count: number;
      total_bill_amount: number;
      total_pay_amount: number;
    }>();

    for (const d of allData) {
      const existing = recruiterMap.get(d.recruiter_user_id);
      if (existing) {
        existing.head_count += d.head_count;
        existing.total_bill_amount += d.total_bill_amount;
        existing.total_pay_amount += d.total_pay_amount;
      } else {
        recruiterMap.set(d.recruiter_user_id, {
          recruiter_name: d.recruiter_name,
          division_name: d.division_name,
          division_id: d.division_id,
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
        });
      }
    }

    // 6. Compute GM$, GP%, Revenue and build unranked rows
    const unranked: Array<Omit<StackRankingRow, 'rank' | 'prior_week_rank' | 'rank_change'>> = [];

    for (const [userId, data] of recruiterMap) {
      const revenue = data.total_bill_amount;
      const gmDollars = data.total_bill_amount - data.total_pay_amount;
      const gpPct = revenue > 0 ? (gmDollars / revenue) * 100 : 0;

      unranked.push({
        recruiter_user_id: userId,
        recruiter_name: data.recruiter_name,
        division_name: data.division_name,
        head_count: data.head_count,
        gross_margin_dollars: Math.round(gmDollars * 100) / 100,
        gross_profit_pct: Math.round(gpPct * 100) / 100,
        revenue: Math.round(revenue * 100) / 100,
      });
    }

    // 7. Sort by GM$ descending, assign ranks
    unranked.sort((a, b) => b.gross_margin_dollars - a.gross_margin_dollars);

    // 8. Get prior week snapshot for change calculation
    const priorWeekStart = this.getPriorWeekStart(weekStart);
    const priorSnapshot = await databaseService.getPriorWeekSnapshot(priorWeekStart);
    const priorRankMap = new Map(
      priorSnapshot.map(s => [s.recruiter_user_id, s.rank])
    );

    // 9. Build final ranked rows
    const rows: StackRankingRow[] = unranked.map((row, index) => {
      const rank = index + 1;
      const priorRank = priorRankMap.get(row.recruiter_user_id) ?? null;
      const rankChange = priorRank !== null ? priorRank - rank : null;

      return {
        ...row,
        rank,
        prior_week_rank: priorRank,
        rank_change: rankChange,
      };
    });

    // 10. Compute totals
    const totals: StackRankingTotals = {
      total_head_count: rows.reduce((sum, r) => sum + r.head_count, 0),
      total_gm_dollars: Math.round(rows.reduce((sum, r) => sum + r.gross_margin_dollars, 0) * 100) / 100,
      total_revenue: Math.round(rows.reduce((sum, r) => sum + r.revenue, 0) * 100) / 100,
      overall_gp_pct: 0,
    };
    totals.overall_gp_pct =
      totals.total_revenue > 0
        ? Math.round((totals.total_gm_dollars / totals.total_revenue) * 100 * 100) / 100
        : 0;

    // 11. Save this week's snapshot
    await databaseService.saveStackRankingSnapshot(weekStart, rows);

    return { rows, totals };
  }

  /**
   * Get the Sunday of the prior week given a week_start date string (YYYY-MM-DD).
   */
  private getPriorWeekStart(weekStart: string): string {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().split('T')[0];
  }

  /**
   * Get the Sunday–Saturday boundaries for last week.
   */
  getLastWeekBoundaries(): { weekStart: string; weekEnd: string } {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun
    const thisSunday = new Date(now);
    thisSunday.setDate(now.getDate() - dayOfWeek);
    thisSunday.setHours(0, 0, 0, 0);

    const lastSunday = new Date(thisSunday);
    lastSunday.setDate(thisSunday.getDate() - 7);
    const lastSaturday = new Date(lastSunday);
    lastSaturday.setDate(lastSunday.getDate() + 6);

    return {
      weekStart: lastSunday.toISOString().split('T')[0],
      weekEnd: lastSaturday.toISOString().split('T')[0],
    };
  }
}

export const stackRankingService = new StackRankingService();
