import { databaseService } from './database';
import {
  FinancialRow,
  FinancialTotals,
  PlacementData,
  RecruiterRole,
  StackRankingRow,
  StackRankingTotals,
} from '../types';

class StackRankingService {
  /**
   * Infer role from a title string.
   */
  inferRole(title: string | null): RecruiterRole {
    if (!title) return 'unknown';
    const t = title.toLowerCase();
    if (
      t.includes('recruiter') ||
      t.includes('staffing specialist') ||
      t.includes('talent acquisition') ||
      t.includes('sourcer')
    ) {
      return 'recruiter';
    }
    if (
      t.includes('account manager') ||
      t.includes('account executive') ||
      t.includes('sales') ||
      t.includes('business development') ||
      t.includes('client manager')
    ) {
      return 'account_manager';
    }
    return 'unknown';
  }

  /**
   * Auto-discover and add new users found in ATS data.
   * Fetches their title, infers role, and adds to user_config.
   */
  async autoDiscoverUsers(
    allData: PlacementData[],
    knownUserIds: Set<number>,
    mappings: { division_id: number; ats_system: string }[]
  ): Promise<void> {
    const atsMap = new Map(mappings.map(m => [m.division_id, m.ats_system]));

    for (const d of allData) {
      if (knownUserIds.has(d.recruiter_user_id)) continue;

      const exists = await databaseService.userConfigExists(d.recruiter_user_id);
      if (exists) {
        knownUserIds.add(d.recruiter_user_id);
        continue;
      }

      try {
        const atsSource = atsMap.get(d.division_id) || 'symplr';
        let title: string | null = null;
        let divisionId = d.division_id || 1;

        if (atsSource === 'bullhorn') {
          title = await databaseService.getUserTitleFromBullhorn(d.recruiter_user_id);
          // Try to match Bullhorn department to an existing division
          const deptName = await databaseService.getUserDepartmentFromBullhorn(d.recruiter_user_id);
          if (deptName) {
            const matchedDivId = await databaseService.findDivisionByName(deptName);
            if (matchedDivId) divisionId = matchedDivId;
          }
        } else {
          title = await databaseService.getUserTitleFromCtmsync(d.recruiter_user_id);
        }

        const role = this.inferRole(title);

        await databaseService.createUserConfig({
          user_id: d.recruiter_user_id,
          user_name: d.recruiter_name || `User ${d.recruiter_user_id}`,
          division_id: divisionId,
          role,
          title: title || undefined,
          ats_source: atsSource,
          on_stack_ranking: true,
          on_hours_report: false,
        });

        knownUserIds.add(d.recruiter_user_id);
        console.log(`Auto-added ${atsSource} user to user_config: ${d.recruiter_name} (ID: ${d.recruiter_user_id}, title: ${title}, role: ${role}, division: ${divisionId})`);
      } catch (err) {
        console.error(`Error auto-adding user ${d.recruiter_user_id}:`, err);
      }
    }
  }

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

    // 3. Get known user_config users and auto-discover new ones
    const userConfigs = await databaseService.getUserConfigs(false);
    const knownUserIds = new Set(userConfigs.map(u => u.user_id));

    const allRawData = [...symplrData, ...bullhornData];
    await this.autoDiscoverUsers(allRawData, knownUserIds, mappings);

    // 3b. Re-fetch user configs after auto-discovery, filter to on_stack_ranking
    const activeUsers = await databaseService.getUserConfigs(false);
    const activeUserIds = new Set(
      activeUsers.filter(u => u.on_stack_ranking).map(u => u.user_id)
    );

    // 4. Filter by mapped divisions
    const filteredSymplr = symplrData.filter(d => symplrDivisions.has(d.division_id));
    const filteredBullhorn = bullhornData.filter(d => bullhornDivisions.has(d.division_id));

    // 5. Merge all placement data
    const allData: PlacementData[] = [...filteredSymplr, ...filteredBullhorn];

    // 6. Aggregate by recruiter (in case a recruiter appears in multiple data sources)
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

    // 7. Compute GM$, GP%, Revenue (only for active user_config users)
    const unranked: Array<Omit<StackRankingRow, 'rank' | 'prior_week_rank' | 'rank_change'>> = [];

    for (const [userId, data] of recruiterMap) {
      if (!activeUserIds.has(userId)) continue;

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

    // 8. Sort by GM$ descending, assign ranks
    unranked.sort((a, b) => b.gross_margin_dollars - a.gross_margin_dollars);

    // 9. Get prior week snapshot for change calculation
    const priorWeekStart = this.getPriorWeekStart(weekStart);
    const priorSnapshot = await databaseService.getPriorWeekSnapshot(priorWeekStart);
    const priorRankMap = new Map(
      priorSnapshot.map(s => [s.recruiter_user_id, s.rank])
    );

    // 10. Build final ranked rows
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

    // 11. Compute totals
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

    // 12. Save this week's snapshot
    await databaseService.saveStackRankingSnapshot(weekStart, rows);

    return { rows, totals };
  }

  /**
   * Get financial data for all users (no ranking, no on_stack_ranking filter).
   * Returns per-user totals: bill, pay, GP$, GM%.
   */
  async getFinancialData(
    weekStart: string,
    weekEnd: string
  ): Promise<{ rows: FinancialRow[]; totals: FinancialTotals }> {
    const mappings = await databaseService.getDivisionAtsMappings();
    const symplrDivisions = new Set(
      mappings.filter(m => m.ats_system === 'symplr').map(m => m.division_id)
    );
    const bullhornDivisions = new Set(
      mappings.filter(m => m.ats_system === 'bullhorn').map(m => m.division_id)
    );

    const [symplrData, bullhornData] = await Promise.all([
      symplrDivisions.size > 0
        ? databaseService.getSymplrPlacementData(weekStart, weekEnd)
        : Promise.resolve([] as PlacementData[]),
      bullhornDivisions.size > 0
        ? databaseService.getBullhornPlacementData(weekStart, weekEnd)
        : Promise.resolve([] as PlacementData[]),
    ]);

    // Filter by mapped divisions and merge
    const filteredSymplr = symplrData.filter(d => symplrDivisions.has(d.division_id));
    const filteredBullhorn = bullhornData.filter(d => bullhornDivisions.has(d.division_id));
    const allData: PlacementData[] = [...filteredSymplr, ...filteredBullhorn];

    // Aggregate by recruiter
    const recruiterMap = new Map<number, {
      recruiter_name: string;
      division_name: string;
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
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
        });
      }
    }

    // Compute GP$, GM% for each user
    const rows: FinancialRow[] = [];
    for (const [userId, data] of recruiterMap) {
      const gpDollars = data.total_bill_amount - data.total_pay_amount;
      const gmPct = data.total_bill_amount > 0 ? (gpDollars / data.total_bill_amount) * 100 : 0;

      rows.push({
        recruiter_user_id: userId,
        recruiter_name: data.recruiter_name,
        division_name: data.division_name,
        head_count: data.head_count,
        total_bill: Math.round(data.total_bill_amount * 100) / 100,
        total_pay: Math.round(data.total_pay_amount * 100) / 100,
        gross_profit_dollars: Math.round(gpDollars * 100) / 100,
        gross_margin_pct: Math.round(gmPct * 100) / 100,
      });
    }

    // Sort by GP$ descending
    rows.sort((a, b) => b.gross_profit_dollars - a.gross_profit_dollars);

    // Compute totals
    const totals: FinancialTotals = {
      total_head_count: rows.reduce((sum, r) => sum + r.head_count, 0),
      total_bill: Math.round(rows.reduce((sum, r) => sum + r.total_bill, 0) * 100) / 100,
      total_pay: Math.round(rows.reduce((sum, r) => sum + r.total_pay, 0) * 100) / 100,
      total_gp_dollars: 0,
      overall_gm_pct: 0,
    };
    totals.total_gp_dollars = Math.round((totals.total_bill - totals.total_pay) * 100) / 100;
    totals.overall_gm_pct = totals.total_bill > 0
      ? Math.round((totals.total_gp_dollars / totals.total_bill) * 100 * 100) / 100
      : 0;

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
