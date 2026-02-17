import { databaseService } from './database';
import {
  AtsSystem,
  FinancialRow,
  FinancialTotals,
  PlacementData,
  RecruiterRole,
  StackRankingRow,
  StackRankingTotals,
  UserConfig,
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
   * Uses ATS-specific ID columns to avoid cross-system ID collisions.
   */
  async autoDiscoverUsers(
    placementData: PlacementData[],
    atsSystem: AtsSystem,
    checkedAtsIds: Set<string>,
  ): Promise<void> {
    for (const d of placementData) {
      const key = `${atsSystem}:${d.recruiter_user_id}`;
      if (checkedAtsIds.has(key)) continue;

      const exists = await databaseService.userConfigExistsByAtsId(atsSystem, d.recruiter_user_id);
      if (exists) {
        checkedAtsIds.add(key);
        continue;
      }

      try {
        let title: string | null = null;
        let divisionId = d.division_id || 1;

        if (atsSystem === 'bullhorn') {
          title = await databaseService.getUserTitleFromBullhorn(d.recruiter_user_id);
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
          ats_source: atsSystem,
          symplr_user_id: atsSystem === 'symplr' ? d.recruiter_user_id : undefined,
          bullhorn_user_id: atsSystem === 'bullhorn' ? d.recruiter_user_id : undefined,
          on_stack_ranking: true,
          on_hours_report: false,
        });

        checkedAtsIds.add(key);
        console.log(`Auto-added ${atsSystem} user to user_config: ${d.recruiter_name} (ID: ${d.recruiter_user_id}, title: ${title}, role: ${role}, division: ${divisionId})`);
      } catch (err) {
        console.error(`Error auto-adding ${atsSystem} user ${d.recruiter_user_id}:`, err);
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

    // 3. Auto-discover new users (check ATS-specific columns)
    const checkedAtsIds = new Set<string>();
    await this.autoDiscoverUsers(symplrData, 'symplr', checkedAtsIds);
    await this.autoDiscoverUsers(bullhornData, 'bullhorn', checkedAtsIds);

    // 3b. Build ATS-to-config maps for resolving ATS IDs to canonical config_id
    const [symplrIdToConfig, bullhornIdToConfig] = await Promise.all([
      databaseService.getAtsIdToConfigMap('symplr'),
      databaseService.getAtsIdToConfigMap('bullhorn'),
    ]);

    // 4. Filter by mapped divisions
    const filteredSymplr = symplrData.filter(d => symplrDivisions.has(d.division_id));
    const filteredBullhorn = bullhornData.filter(d => bullhornDivisions.has(d.division_id));

    // 5-6. Aggregate by config_id (not ATS user_id) so same person's data from both systems combines
    const configAggMap = new Map<number, {
      config: UserConfig;
      head_count: number;
      total_bill_amount: number;
      total_pay_amount: number;
    }>();

    const aggregatePlacement = (d: PlacementData, config: UserConfig) => {
      const existing = configAggMap.get(config.config_id);
      if (existing) {
        existing.head_count += d.head_count;
        existing.total_bill_amount += d.total_bill_amount;
        existing.total_pay_amount += d.total_pay_amount;
      } else {
        configAggMap.set(config.config_id, {
          config,
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
        });
      }
    };

    for (const d of filteredSymplr) {
      const config = symplrIdToConfig.get(d.recruiter_user_id);
      if (config) aggregatePlacement(d, config);
    }
    for (const d of filteredBullhorn) {
      const config = bullhornIdToConfig.get(d.recruiter_user_id);
      if (config) aggregatePlacement(d, config);
    }

    // 7. Compute GM$, GP%, Revenue (only for on_stack_ranking users)
    const divisions = await databaseService.getDivisions(false);
    const divisionNameMap = new Map(divisions.map(d => [d.division_id, d.division_name]));
    const unranked: Array<Omit<StackRankingRow, 'rank' | 'prior_week_rank' | 'rank_change'>> = [];

    for (const [, agg] of configAggMap) {
      if (!agg.config.on_stack_ranking) continue;
      const { config: userConfig } = agg;

      const revenue = agg.total_bill_amount;
      const gmDollars = agg.total_bill_amount - agg.total_pay_amount;
      const gpPct = revenue > 0 ? (gmDollars / revenue) * 100 : 0;

      unranked.push({
        recruiter_user_id: userConfig.user_id,
        recruiter_name: userConfig.user_name,
        division_name: divisionNameMap.get(userConfig.division_id) || 'Unknown',
        head_count: agg.head_count,
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

    // Auto-discover new users from ATS data (same as calculateRanking)
    const checkedAtsIds = new Set<string>();
    await this.autoDiscoverUsers(symplrData, 'symplr', checkedAtsIds);
    await this.autoDiscoverUsers(bullhornData, 'bullhorn', checkedAtsIds);

    // Filter by mapped divisions
    const filteredSymplr = symplrData.filter(d => symplrDivisions.has(d.division_id));
    const filteredBullhorn = bullhornData.filter(d => bullhornDivisions.has(d.division_id));

    // Build ATS-to-config maps for resolving IDs (after discovery so new users are included)
    const [symplrIdToConfig, bullhornIdToConfig] = await Promise.all([
      databaseService.getAtsIdToConfigMap('symplr'),
      databaseService.getAtsIdToConfigMap('bullhorn'),
    ]);

    // Aggregate by config_id (not ATS user_id)
    const configAggMap = new Map<number, {
      config: UserConfig;
      head_count: number;
      total_bill_amount: number;
      total_pay_amount: number;
    }>();

    const aggregateFin = (d: PlacementData, config: UserConfig) => {
      const existing = configAggMap.get(config.config_id);
      if (existing) {
        existing.head_count += d.head_count;
        existing.total_bill_amount += d.total_bill_amount;
        existing.total_pay_amount += d.total_pay_amount;
      } else {
        configAggMap.set(config.config_id, {
          config,
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
        });
      }
    };

    for (const d of filteredSymplr) {
      const config = symplrIdToConfig.get(d.recruiter_user_id);
      if (config) aggregateFin(d, config);
    }
    for (const d of filteredBullhorn) {
      const config = bullhornIdToConfig.get(d.recruiter_user_id);
      if (config) aggregateFin(d, config);
    }

    // Compute GP$, GM% for each user
    const divs = await databaseService.getDivisions(false);
    const divNameMap = new Map(divs.map(d => [d.division_id, d.division_name]));
    const rows: FinancialRow[] = [];
    for (const [, agg] of configAggMap) {
      const gpDollars = agg.total_bill_amount - agg.total_pay_amount;
      const gmPct = agg.total_bill_amount > 0 ? (gpDollars / agg.total_bill_amount) * 100 : 0;

      rows.push({
        recruiter_user_id: agg.config.user_id,
        recruiter_name: agg.config.user_name,
        division_name: divNameMap.get(agg.config.division_id) || 'Unknown',
        head_count: agg.head_count,
        total_bill: Math.round(agg.total_bill_amount * 100) / 100,
        total_pay: Math.round(agg.total_pay_amount * 100) / 100,
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
