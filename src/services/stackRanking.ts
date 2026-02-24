import { databaseService } from './database';
import { configService } from './config';
import {
  AtsSystem,
  FinancialRow,
  FinancialTotals,
  PlacementData,
  StackRankingRow,
  StackRankingTotals,
  UserConfig,
} from '../types';

class StackRankingService {
  /**
   * Calculate stack ranking for a given week.
   * Queries both ATS systems, merges results,
   * computes GM$, GP%, ranks by GM$ descending, and compares to prior week.
   * Users must already exist in user_config (populated by nightly user sync).
   */
  async calculateRanking(
    weekStart: string,
    weekEnd: string
  ): Promise<{ rows: StackRankingRow[]; totals: StackRankingTotals; _debug?: Record<string, unknown> }> {
    // 1. Query both ATS systems — catch Bullhorn errors separately so Symplr still works
    let bullhornError: string | null = null;
    const symplrData = await databaseService.getSymplrPlacementData(weekStart, weekEnd);
    let bullhornData: PlacementData[] = [];
    try {
      bullhornData = await databaseService.getBullhornPlacementData(weekStart, weekEnd);
    } catch (err) {
      bullhornError = err instanceof Error ? err.message : String(err);
      console.error('Bullhorn query failed in calculateRanking:', bullhornError);
    }

    console.log(`Stack ranking: Symplr returned ${symplrData.length} records, Bullhorn returned ${bullhornData.length} records`);

    // 2. Build ATS-to-config maps for resolving ATS IDs to canonical config_id
    const [symplrIdToConfig, bullhornIdToConfig] = await Promise.all([
      databaseService.getAtsIdToConfigMap('symplr'),
      databaseService.getAtsIdToConfigMap('bullhorn'),
    ]);

    console.log(`Config maps: Symplr has ${symplrIdToConfig.size} entries, Bullhorn has ${bullhornIdToConfig.size} entries`);

    // 3. Aggregate by config_id (not ATS user_id) so same person's data from both systems combines
    const configAggMap = new Map<number, {
      config: UserConfig;
      head_count: number;
      total_bill_amount: number;
      total_pay_amount: number;
      non_taxable_pay: number;
    }>();

    const aggregatePlacement = (d: PlacementData, config: UserConfig) => {
      const existing = configAggMap.get(config.config_id);
      if (existing) {
        existing.head_count += d.head_count;
        existing.total_bill_amount += d.total_bill_amount;
        existing.total_pay_amount += d.total_pay_amount;
        existing.non_taxable_pay += d.non_taxable_pay;
      } else {
        configAggMap.set(config.config_id, {
          config,
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
          non_taxable_pay: d.non_taxable_pay,
        });
      }
    };

    let symplrMatched = 0, symplrDropped = 0;
    for (const d of symplrData) {
      const config = symplrIdToConfig.get(d.recruiter_user_id);
      if (config) { aggregatePlacement(d, config); symplrMatched++; }
      else { symplrDropped++; console.warn(`Symplr user ${d.recruiter_user_id} (${d.recruiter_name}) has no config match`); }
    }
    let bullhornMatched = 0, bullhornDropped = 0;
    for (const d of bullhornData) {
      const config = bullhornIdToConfig.get(d.recruiter_user_id);
      if (config) { aggregatePlacement(d, config); bullhornMatched++; }
      else { bullhornDropped++; console.warn(`Bullhorn user ${d.recruiter_user_id} (${d.recruiter_name}) has no config match`); }
    }

    const _debug: Record<string, unknown> = {
      symplrQueryRows: symplrData.length,
      bullhornQueryRows: bullhornData.length,
      bullhornError,
      bullhornConfig: bullhornError ? databaseService.getBullhornConfigSummary() : undefined,
      symplrConfigMapSize: symplrIdToConfig.size,
      bullhornConfigMapSize: bullhornIdToConfig.size,
      symplrMatched,
      symplrDropped,
      bullhornMatched,
      bullhornDropped,
    };

    // 4. Compute GM$, GP%, Revenue (only for on_stack_ranking users)
    // Fetch burden rates for GM$ calculation
    const symplrBurden = parseFloat(await configService.get('SYMPLR_BURDEN', '0'));
    const bullhornBurden = parseFloat(await configService.get('BULLHORN_BURDEN', '0'));

    const divisions = await databaseService.getDivisions(false);
    const divisionNameMap = new Map(divisions.map(d => [d.division_id, d.division_name]));
    const unranked: Array<Omit<StackRankingRow, 'rank' | 'prior_week_rank' | 'rank_change'>> = [];

    for (const [, agg] of configAggMap) {
      if (!agg.config.on_stack_ranking) continue;
      const { config: userConfig } = agg;

      const revenue = agg.total_bill_amount;

      // Apply burden: GM$ = total_bill - ((taxable_pay * (1 + burden/100)) + non_taxable_pay)
      const burden = userConfig.ats_source === 'bullhorn' ? bullhornBurden : symplrBurden;
      const taxablePay = agg.total_pay_amount - agg.non_taxable_pay;
      const gmDollars = revenue - ((taxablePay * (1 + burden / 100)) + agg.non_taxable_pay);
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

    // 5. Sort by GM$ descending, assign ranks
    unranked.sort((a, b) => b.gross_margin_dollars - a.gross_margin_dollars);

    // 6. Get prior week snapshot for change calculation
    const priorWeekStart = this.getPriorWeekStart(weekStart);
    const priorSnapshot = await databaseService.getPriorWeekSnapshot(priorWeekStart);
    const priorRankMap = new Map(
      priorSnapshot.map(s => [s.recruiter_user_id, s.rank])
    );

    // 7. Build final ranked rows
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

    // 8. Compute totals
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

    // 9. Save this week's snapshot
    await databaseService.saveStackRankingSnapshot(weekStart, rows);

    return { rows, totals, _debug };
  }

  /**
   * Get financial data for all users (no ranking, no on_stack_ranking filter).
   * Returns per-user totals: bill, pay, GM$, GP%.
   * Users must already exist in user_config (populated by nightly user sync).
   */
  async getFinancialData(
    weekStart: string,
    weekEnd: string
  ): Promise<{ rows: FinancialRow[]; totals: FinancialTotals; _debug?: Record<string, unknown> }> {
    // Query both ATS systems — catch Bullhorn errors separately so Symplr still works
    let bullhornError: string | null = null;
    const symplrData = await databaseService.getSymplrPlacementData(weekStart, weekEnd);
    let bullhornData: PlacementData[] = [];
    try {
      bullhornData = await databaseService.getBullhornPlacementData(weekStart, weekEnd);
    } catch (err) {
      bullhornError = err instanceof Error ? err.message : String(err);
      console.error('Bullhorn query failed in getFinancialData:', bullhornError);
    }

    console.log(`Financials: Symplr returned ${symplrData.length} records, Bullhorn returned ${bullhornData.length} records`);

    // Build ATS-to-config maps — only active users (inactive = hidden from everything)
    const [symplrIdToConfig, bullhornIdToConfig] = await Promise.all([
      databaseService.getAtsIdToConfigMap('symplr'),
      databaseService.getAtsIdToConfigMap('bullhorn'),
    ]);

    // Aggregate by config_id — only users with an active config entry appear
    const aggMap = new Map<string, {
      recruiter_user_id: number;
      recruiter_name: string;
      ats_source: string | null;
      division_id: number;
      head_count: number;
      total_bill_amount: number;
      total_pay_amount: number;
      non_taxable_pay: number;
    }>();

    const aggregateFin = (d: PlacementData, atsSystem: AtsSystem) => {
      const configMap = atsSystem === 'symplr' ? symplrIdToConfig : bullhornIdToConfig;
      const config = configMap.get(d.recruiter_user_id);
      if (!config) return;

      const key = `config:${config.config_id}`;
      const existing = aggMap.get(key);
      if (existing) {
        existing.head_count += d.head_count;
        existing.total_bill_amount += d.total_bill_amount;
        existing.total_pay_amount += d.total_pay_amount;
        existing.non_taxable_pay += d.non_taxable_pay;
      } else {
        aggMap.set(key, {
          recruiter_user_id: config.user_id,
          recruiter_name: config.user_name,
          ats_source: config.ats_source,
          division_id: config.division_id,
          head_count: d.head_count,
          total_bill_amount: d.total_bill_amount,
          total_pay_amount: d.total_pay_amount,
          non_taxable_pay: d.non_taxable_pay,
        });
      }
    };

    for (const d of symplrData) {
      aggregateFin(d, 'symplr');
    }
    for (const d of bullhornData) {
      aggregateFin(d, 'bullhorn');
    }

    console.log(`Financials: Config maps - Symplr: ${symplrIdToConfig.size}, Bullhorn: ${bullhornIdToConfig.size}. Aggregated ${aggMap.size} unique users.`);

    const _debug: Record<string, unknown> = {
      symplrQueryRows: symplrData.length,
      bullhornQueryRows: bullhornData.length,
      bullhornError,
      bullhornConfig: bullhornError ? databaseService.getBullhornConfigSummary() : undefined,
      symplrConfigMapSize: symplrIdToConfig.size,
      bullhornConfigMapSize: bullhornIdToConfig.size,
      aggregatedUsers: aggMap.size,
    };

    // Compute GM$, GP% for each user with burden
    const symplrBurden = parseFloat(await configService.get('SYMPLR_BURDEN', '0'));
    const bullhornBurden = parseFloat(await configService.get('BULLHORN_BURDEN', '0'));

    const divs = await databaseService.getDivisions(false);
    const divNameMap = new Map(divs.map(d => [d.division_id, d.division_name]));
    const rows: FinancialRow[] = [];
    for (const [, agg] of aggMap) {
      const burden = agg.ats_source === 'bullhorn' ? bullhornBurden : symplrBurden;
      const nonTaxable = agg.non_taxable_pay;
      const taxable = agg.total_pay_amount - nonTaxable;
      // GM$ = total_bill - ((taxable_pay * (1 + burden/100)) + non_taxable_pay)
      const gmDollars = agg.total_bill_amount - ((taxable * (1 + burden / 100)) + nonTaxable);
      const gpPct = agg.total_bill_amount > 0 ? (gmDollars / agg.total_bill_amount) * 100 : 0;

      rows.push({
        recruiter_user_id: agg.recruiter_user_id,
        recruiter_name: agg.recruiter_name,
        division_name: divNameMap.get(agg.division_id) || 'Unknown',
        head_count: agg.head_count,
        total_bill: Math.round(agg.total_bill_amount * 100) / 100,
        total_pay: Math.round(agg.total_pay_amount * 100) / 100,
        taxable_pay: Math.round(taxable * 100) / 100,
        non_taxable_pay: Math.round(nonTaxable * 100) / 100,
        gross_margin_dollars: Math.round(gmDollars * 100) / 100,
        gross_profit_pct: Math.round(gpPct * 100) / 100,
      });
    }

    // Sort by GM$ descending
    rows.sort((a, b) => b.gross_margin_dollars - a.gross_margin_dollars);

    // Compute totals
    const totalBill = Math.round(rows.reduce((sum, r) => sum + r.total_bill, 0) * 100) / 100;
    const totalPay = Math.round(rows.reduce((sum, r) => sum + r.total_pay, 0) * 100) / 100;
    const totalTaxable = Math.round(rows.reduce((sum, r) => sum + r.taxable_pay, 0) * 100) / 100;
    const totalNonTaxable = Math.round(rows.reduce((sum, r) => sum + r.non_taxable_pay, 0) * 100) / 100;
    const totalGm = Math.round(rows.reduce((sum, r) => sum + r.gross_margin_dollars, 0) * 100) / 100;
    const totals: FinancialTotals = {
      total_head_count: rows.reduce((sum, r) => sum + r.head_count, 0),
      total_bill: totalBill,
      total_pay: totalPay,
      total_taxable_pay: totalTaxable,
      total_non_taxable_pay: totalNonTaxable,
      total_gm_dollars: totalGm,
      overall_gp_pct: totalBill > 0
        ? Math.round((totalGm / totalBill) * 100 * 100) / 100
        : 0,
    };

    return { rows, totals, _debug };
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
